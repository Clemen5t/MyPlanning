# Mise en service de MyPlanning v0.07

La v0.07 ajoute les comptes, les sessions et les plannings privés. **Ne pas fusionner
sur `main` avant d’avoir préparé D1 et Supabase** : les builds Cloudflare et GitHub
Pages existants peuvent se déclencher automatiquement. Le Worker conserve le nom
`myplanning` et son secret `GROQ_API_KEY`.

## Architecture et coût

- Le même Worker sert les fichiers publics et les API. Adresse initiale :
  `https://myplanning.v76y74m25h.workers.dev/`.
- Supabase Auth hébergé vérifie les emails et les mots de passe, hachés par le
  service (bcrypt). Aucun mot de passe ni hash de mot de passe dans D1, GitHub ou
  le stockage du navigateur. Le Worker transmet le mot de passe à Supabase en
  HTTPS uniquement le temps de la requête. Les jetons Supabase restent en mémoire
  serveur et ne sont ni renvoyés au navigateur ni sauvegardés.
- D1 contient les profils, les réservations d’identifiants (24 h), les plannings,
  les compteurs anti-abus et les empreintes SHA-256 de sessions aléatoires de
  256 bits. Le cookie `__Host-myplanning` est `HttpOnly`, `Secure`, `SameSite=Lax`,
  sans `Domain`, expire après 30 jours et est révocable immédiatement côté D1.
- Les écritures exigent une origine identique et un jeton CSRF conservé seulement
  en mémoire. L’identité du propriétaire vient exclusivement de la session.
- Une révision entière empêche deux appareils d’écraser leurs modifications.
  Toutes les réponses API ont `Cache-Control: no-store`. Le service worker ne
  met en cache que l’icône et le manifeste et purge les anciens caches MyPlanning.
- Le scanner exige une session, limite le volume/fréquence des requêtes et
  conserve le modèle, le prompt et le contrat Groq de v0.06. Les photos ne sont
  pas enregistrées dans D1 ; elles sont transmises à Groq pour analyse.

Cette architecture vise les offres gratuites Cloudflare Workers/D1 et Supabase
Auth, sous leurs quotas. Un hachage robuste directement dans le Worker risque de
dépasser la limite CPU du plan gratuit ; aucun paramètre cryptographique n’est
affaibli pour contourner cette limite. L’envoi public d’emails nécessite un SMTP
configuré dans Supabase (offre gratuite possible selon le fournisseur et les
quotas ; domaine d’envoi éventuellement payant). Aucune souscription ni ressource
payante n’est créée par ce code.

Références : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/),
[D1 gratuit](https://developers.cloudflare.com/d1/platform/pricing/),
[offres Supabase](https://supabase.com/pricing),
[stockage des mots de passe](https://supabase.com/docs/guides/auth/password-security),
[emails et SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## 1. Préparer Supabase

Créer un projet Supabase dédié. Dans Authentication :

1. Activer Email / Password et **Confirm email**. Ne pas activer d’inscription
   anonyme. Configurer une longueur minimale de 12 caractères. L’application
   limite aussi le mot de passe à 72 octets pour éviter toute troncature bcrypt.
2. Site URL : `https://myplanning.v76y74m25h.workers.dev/`. Ajouter cette URL aux
   redirections autorisées. Pour un domaine personnalisé, utiliser ce domaine
   pour l’app, les emails et l’API ; pas de cookies tiers GitHub → Cloudflare.
3. Configurer un SMTP de production. Le SMTP par défaut de Supabase est réservé
   aux essais, restreint en destinataires et en débit. Tester une adresse qui
   n’appartient pas à l’équipe Supabase avant d’ouvrir les inscriptions.
4. Modifier les deux modèles d’email ci-dessous. Ces liens mettent le jeton à
   usage unique dans le **fragment** (`#`), absent des journaux HTTP. L’interface
   retire immédiatement ce fragment de l’historique et demande une action avant
   de consommer le lien, ce qui évite sa consommation par un aperçu d’email.

**Confirm signup** :

```html
<h2>Bienvenue sur MyPlanning</h2>
<p><a href="{{ .SiteURL }}#token_hash={{ .TokenHash }}&type=signup">Confirmer mon email</a></p>
```

**Reset password** :

```html
<h2>Réinitialiser mon mot de passe</h2>
<p><a href="{{ .SiteURL }}#token_hash={{ .TokenHash }}&type=recovery">Choisir un nouveau mot de passe</a></p>
```

Les emails doivent pointer vers le Worker, pas vers l’ancien site GitHub Pages.
Si le lien expire ou si la page est rechargée après retrait du fragment, demander
un nouvel email de récupération. Une inscription en attente peut être retentée
avec le même email pour renvoyer la confirmation selon les limites Supabase.
Le formulaire de récupération ne révèle pas si l’adresse existe.

## 2. Créer D1 et configurer les secrets

Depuis la racine du dépôt, avec Node.js 24 :

```sh
npm ci
npx wrangler login
npx wrangler d1 create myplanning
```

Remplacer l’UUID nul de `database_id` dans le **seul** `wrangler.toml` à la racine
par l’identifiant renvoyé. Ne pas créer un second Worker ni réutiliser une base
contenant des données d’une autre application.

```sh
npx wrangler d1 migrations apply myplanning --remote
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
```

Saisir les valeurs aux invites, jamais dans le code ou les arguments de commande.

| Configuration | Où / valeur |
| --- | --- |
| `DB` | Binding D1 `myplanning`, identifiant propre au compte Cloudflare |
| `SUPABASE_URL` | Secret : URL `https://<projet>.supabase.co`, sans chemin |
| `SUPABASE_PUBLISHABLE_KEY` | Secret : clé **publishable**, ou ancienne clé `anon` du même projet |
| `GROQ_API_KEY` | Secret **existant à conserver**, ne pas le remplacer ni l’exposer |
| `GROQ_MODEL` | Variable optionnelle ; défaut conservé : `qwen/qwen3.8-27b` |

Aucune clé Supabase `service_role` / secret d’administration n’est nécessaire.
La clé publishable n’est pas un secret privilégié, mais reste côté Worker pour
centraliser l’intégration. Les secrets requis sont déclarés dans Wrangler ;
`keep_vars=true` est conservé. La journalisation Worker est désactivée par défaut.
Ne jamais ajouter de journalisation des corps, cookies ou en-têtes d’autorisation.

## 3. Vérifier et publier

```sh
npm test
npm run build
npx wrangler deploy --dry-run
```

`npm test` utilise workerd/Miniflare, D1 local et des simulations des services
Supabase/Groq. Les tests couvrent aussi l’interface avec jsdom. Ils ne vérifient
pas l’envoi réel d’emails, les limites CPU en production ou la lecture d’une vraie
photo par Groq. Sous Windows, si le bac à sable empêche workerd d’ouvrir SQLite,
un repli est disponible : `$env:MYPLANNING_TEST_RUNTIME='node'; npm test` dans
PowerShell. Ce repli utilise les mêmes handlers avec SQLite natif, sans émuler
les contraintes du runtime Cloudflare. La CI Linux utilise toujours workerd.

Après préparation des ressources et secrets, publier d’abord le Worker :

```sh
npm run deploy
```

Workers Builds : racine `/`, branche de production `main`, installation `npm ci`,
commande de déploiement `npx wrangler deploy`. La configuration lance déjà
`npm run build` et n’envoie que `dist/`. Le workflow GitHub Pages publie lui aussi
uniquement `dist/`, jamais les fichiers Worker, tests ou secrets.

Avant publication du point d’entrée GitHub Pages, vérifier sur le Worker :

- `/health` : version `0.07`, `auth_configured:true`, `groq_secret:true`.
- Inscription avec un nouvel email, réception/confirmation, connexion via email
  puis identifiant, rechargement et fermeture/réouverture du navigateur.
- Créer un horaire, le retrouver sur un second appareil ; un autre compte voit
  un planning vide. Modifier simultanément pour vérifier le message de conflit.
- Modifier le profil, changer/récupérer le mot de passe et constater que les
  autres sessions sont révoquées ; tester les deux boutons de déconnexion.
- Scanner une vraie photo : vérifier les horaires proposés puis les importer.
  Confirmer le comportement sur Safari/iPhone et la PWA installée.

Le code est préparé pour publication ; ces contrôles nécessitent les ressources
Cloudflare/Supabase configurées. Ne pas considérer les simulations comme une
validation de production. En cas de rollback, conserver D1 et les secrets et
restaurer une version précédente du Worker ; ne pas supprimer les données.

## 4. Migrer les données v0.06

L’ancienne adresse `https://clemen5t.github.io/MyPlanning/` affiche un point
d’entrée v0.07 avec **Exporter mon ancien planning** et le lien Cloudflare.
Le changement de domaine interdit l’accès automatique à son ancien localStorage.

1. Depuis le navigateur/appareil qui possède le planning, exporter le JSON.
2. Ouvrir le Worker, créer/confirmer son compte, se connecter.
3. Réglages → Restaurer JSON. Le fichier est validé et un avertissement précise
   qu’il remplace le planning du compte connecté. Vérifier le résultat.
4. Revenir à l’ancienne adresse et effacer la copie locale si souhaité. Conserver
   le fichier de sauvegarde dans un emplacement personnel sûr.

Si une copie v0.06 existe déjà **sur la même origine**, un bouton d’import apparaît
dans Réglages : import volontaire, fusion conservant les journées du compte,
suppression locale seulement après sauvegarde serveur réussie. Aucune donnée
locale n’est automatiquement affectée au premier utilisateur qui se connecte.

La v0.07 requiert une connexion pour charger/sauvegarder. Une erreur de sauvegarde
reste affichée avec réessai, export des modifications et rechargement explicite.
Les données en mémoire sont effacées à la déconnexion, à l’expiration détectée et
lors d’un changement de compte. Les sessions sont revérifiées au retour sur la
page et chaque minute lorsqu’elle est visible. Les fenêtres communiquent via
BroadcastChannel lorsque disponible. Les modifications non enregistrées ne
survivent pas à la fermeture de la page.

## Exploitation

- Le cron quotidien purge les sessions, réservations et compteurs expirés.
- Une session expire après 30 jours sans prolongation implicite. « Déconnecter
  tous mes appareils » et les changements/récupérations de mot de passe dans
  l’app révoquent les sessions D1. Une erreur réseau lors de la déconnexion est
  affichée : ne pas promettre une révocation non confirmée par le serveur.
- Les changements de mot de passe via un autre client Supabase ou le dashboard
  n’ont pas de webhook automatique vers D1 : révoquer alors les sessions D1 du
  compte. Utiliser un projet dédié et les parcours de l’app pour les utilisateurs.
- Le changement d’email n’est pas proposé en v0.07. L’email confirmé identifie le
  compte ; le nom et l’identifiant sont modifiables dans le profil.
- Pour supprimer un compte à sa demande, supprimer d’abord ses sessions et sa
  ligne `users` dans D1 (les plannings sont supprimés par cascade), puis son
  utilisateur Supabase. Ne supprimer aucune donnée sans identifier le bon UUID.
- Avant ouverture publique : prévoir un contact de support, une notice de
  confidentialité (Cloudflare, Supabase, Groq), la politique de conservation et
  les quotas/alertes adaptés au trafic. Les compteurs applicatifs sont des
  protections de base, pas une garantie contre une attaque distribuée.
