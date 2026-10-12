# MyPlanning v0.08

Planning personnel avec la même interface que v0.06 : semaine, mois, statistiques,
créneaux, pauses, export calendrier et scanner photo Groq.

La v0.08 ajoute des **comptes identifiant + mot de passe**, sans email obligatoire
et sans confirmation par email. Le fonctionnement reprend le principe déjà utilisé
dans Disney Wait / MagicWait, avec D1 à la place de KV pour les données privées.

- mot de passe dérivé côté Worker avec PBKDF2 / SHA-256, sel aléatoire et 100 000 itérations ;
- aucun mot de passe en clair dans D1, GitHub, localStorage ou le cookie ;
- sessions aléatoires de 256 bits, stockées dans D1 uniquement sous empreinte SHA-256 ;
- cookie `__Host-myplanning` HttpOnly, Secure, SameSite=Lax, 30 jours ;
- protection CSRF et limites de tentatives de connexion/inscription ;
- profil modifiable, changement de mot de passe et déconnexion de tous les appareils ;
- plannings privés par utilisateur dans Cloudflare D1 ;
- scanner Groq protégé par connexion et `GROQ_API_KEY` conservé côté Worker.

Il n’y a **pas encore de récupération de mot de passe** : l’utilisateur doit
conserver sa phrase de passe. Aucune adresse email n’est collectée pour le compte.

## Configuration

Lire [DEPLOYMENT.md](DEPLOYMENT.md). La base D1 `myplanning` est utilisée via
le binding `DB`. Le seul secret obligatoire pour les fonctions actuelles est
`GROQ_API_KEY`.

## Développement

Node.js 24 :

```sh
npm ci
npm test
npm run build
npx wrangler deploy --dry-run
```

Les tests utilisent workerd/Miniflare et D1 local. Un repli SQLite natif pour
Windows est disponible avec `MYPLANNING_TEST_RUNTIME=node`.


## Calendrier iPhone

La v0.08 ajoute un abonnement calendrier privé par compte. Depuis Réglages, l’utilisateur peut générer un lien d’abonnement iPhone. Le lien est un secret de lecture : sa valeur n’est pas stockée en clair dans D1, uniquement son empreinte SHA-256. Régénérer le lien révoque l’ancien abonnement.

Le flux est en lecture seule : MyPlanning → Calendrier. Les changements faits directement dans Calendrier ne sont pas renvoyés vers MyPlanning. Le rythme d’actualisation est décidé par iOS et peut ne pas être instantané.

Un vrai widget MyPlanning sur l’écran d’accueil iPhone nécessite une app iOS avec une extension WidgetKit ; une PWA seule ne peut pas publier un widget système.
