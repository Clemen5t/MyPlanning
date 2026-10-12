# Mise en service de MyPlanning v0.08

La v0.08 utilise désormais le même principe de compte que Disney Wait / MagicWait :
**identifiant + mot de passe, sans email et sans confirmation email**.

Le Worker Cloudflare gère l’authentification et D1 stocke les comptes, sessions et
plannings privés. Supabase n’est pas utilisé par MyPlanning.

## Architecture

- Application + API : `https://myplanning.v76y74m25h.workers.dev/`
- Cloudflare Worker : authentification, API planning, scanner Groq.
- D1 `myplanning` : utilisateurs, sessions, plannings, limites anti-abus.
- `GROQ_API_KEY` : secret Cloudflare existant.
- Aucun email, SMTP, clé Supabase ou service d’authentification externe requis.

### Sécurité des comptes

Le mot de passe est dérivé avec PBKDF2 / SHA-256, un sel aléatoire de 128 bits et
100 000 itérations. D1 ne reçoit que le sel et la dérivation. Une session utilise
un jeton aléatoire de 256 bits ; seule son empreinte SHA-256 est enregistrée en
base. Le navigateur reçoit un cookie `__Host-myplanning` HttpOnly, Secure,
SameSite=Lax, sans Domain, expirant après 30 jours.

Les routes mutantes exigent une origine identique et un jeton CSRF. Les tentatives
de connexion et d’inscription sont limitées côté D1. Le propriétaire d’un planning
est toujours déterminé par la session serveur.

**Limite actuelle :** il n’existe pas de récupération de mot de passe. Ne promets
pas de récupération automatique à un utilisateur qui l’a perdu.

## 1. Base D1

Base de production :

```text
name: myplanning
database_id: f1ae57ca-b698-4b1a-ab43-42332c2fa1fb
binding: DB
```

La base a été initialisée avant le changement d’architecture avec l’ancien schéma
email/Supabase, qui n’a jamais été publié. Avant la première mise en ligne v0.08,
appliquer **une seule fois** le contenu de :

```text
worker/migrations/0002_no_email_accounts.sql
```

dans la console D1 de `myplanning`.

Cette migration supprime uniquement les tables de comptes/plannings pré-lancement
et les recrée avec le schéma identifiant + mot de passe. Elle doit être exécutée
avant la création du premier compte réel.

Pour une nouvelle base créée depuis zéro, Wrangler applique les migrations dans
l’ordre :

```sh
npx wrangler d1 migrations apply myplanning --remote
```

## 2. Cloudflare

Le `wrangler.toml` à la racine contient déjà le binding D1. Conserver le secret :

```text
GROQ_API_KEY
```

Aucun `SUPABASE_URL` ou `SUPABASE_PUBLISHABLE_KEY` n’est nécessaire.

Workers Builds :

```text
Root directory: /
Install command: npm ci
Deploy command: npx wrangler deploy
Production branch: main
```

Le build exécute `npm run build` et publie uniquement `dist/`.

## 3. Vérifier avant fusion

```sh
npm test
npm run build
npx wrangler deploy --dry-run
```

La CI GitHub doit être verte.

Après déploiement, vérifier :

- `/health` : `version:"0.07"`, `auth_configured:true`, `groq_secret:true` ;
- création d’un compte uniquement avec nom, identifiant et mot de passe ;
- aucune demande d’email ;
- reconnexion avec l’identifiant sur un autre navigateur/appareil ;
- persistance de la session après rechargement ;
- isolation des plannings entre deux comptes ;
- changement d’identifiant et de nom affiché ;
- changement de mot de passe, qui révoque les autres sessions ;
- « Déconnecter tous mes appareils » ;
- scanner d’une vraie photo puis import des horaires proposés.

## 4. Migration du planning v0.06

L’ancien domaine GitHub Pages sert de passerelle :

1. exporter l’ancien planning JSON depuis l’appareil qui le possède ;
2. ouvrir l’app Cloudflare ;
3. créer un compte ;
4. Réglages → Restaurer JSON ;
5. vérifier le planning avant d’effacer la copie locale.

Si une copie v0.06 existe déjà sur la même origine, l’import local reste volontaire
et la copie n’est supprimée qu’après sauvegarde serveur réussie.

## Exploitation

Le cron quotidien supprime les sessions et compteurs expirés. Les photos du scanner
ne sont pas stockées dans D1 ; elles sont transmises à Groq pour analyse.

Le projet Supabase créé pendant les essais n’est pas utilisé et peut rester vide
ou être mis en pause séparément. Il ne doit fournir aucune clé à MyPlanning.


## Calendrier iPhone v0.08

Le Worker crée automatiquement la table d’abonnement lors de la première utilisation. La migration reste aussi disponible pour les déploiements administrés :

```text
worker/migrations/0003_calendar_feeds.sql
```

Cette migration est additive et crée uniquement `calendar_feeds`. Elle ne modifie ni les comptes ni les plannings existants. Il n’est donc pas nécessaire d’exécuter manuellement du SQL pour la mise à jour v0.08.

Après déploiement, vérifier qu’un utilisateur connecté peut créer un lien dans Réglages → Calendrier iPhone, que le lien `/calendar/<jeton>.ics` renvoie `text/calendar`, puis que la révocation rend le lien inutilisable.
