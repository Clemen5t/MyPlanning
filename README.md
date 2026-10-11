# MyPlanning v0.07

Planning personnel en français, avec la même interface sombre que v0.06 : semaine,
mois, statistiques, créneaux, pauses, export calendrier et scanner photo Groq.

La v0.07 ajoute inscription et confirmation d’email, connexion par email ou
identifiant, profil modifiable, mot de passe oublié, sessions persistantes et
déconnexion d’un appareil ou de tous les appareils. Les plannings sont privés,
stockés dans Cloudflare D1 et liés au compte connecté.

- Supabase Auth prend en charge les mots de passe ; ils ne sont jamais enregistrés
  dans le navigateur, dans D1 ou dans le dépôt.
- Le Worker Cloudflare existant sert l’app et les API sur la même origine.
- Cookies de session HttpOnly/Secure, protection CSRF, limites de tentatives,
  validation des imports et prévention des conflits entre appareils.
- `GROQ_API_KEY` reste un secret Worker. Le scanner exige désormais une connexion.
- Les données v0.06 restent exportables sur l’ancien domaine GitHub Pages, puis
  importables dans le compte. Le chargement et la sauvegarde nécessitent internet.

## Configuration et mise en service

Lire [DEPLOYMENT.md](DEPLOYMENT.md) : création D1, secrets, projet Supabase et SMTP,
modèles d’emails, migration, publication et vérifications réelles.

**Préparer ces ressources avant de fusionner sur `main`**, qui peut déclencher les
publications Cloudflare et GitHub Pages. Le dépôt contient un UUID D1 de remplacement,
pas une base de production déjà configurée.

## Développement

Node.js 24 :

```sh
npm ci
npm test
npm run build
npx wrangler deploy --dry-run
```

Pour un environnement local : renseigner les secrets de test dans `.dev.vars`
(ignoré par Git), appliquer `npx wrangler d1 migrations apply myplanning --local`,
puis `npm run dev`. Utiliser un projet Supabase de développement et ses URL de
redirection locales ; ne pas copier des données ou secrets de production.

Les tests passent par workerd et D1 local, avec Supabase/Groq simulés. Un repli
SQLite natif pour les environnements Windows restreints est décrit dans le guide.
Les services réels, l’envoi d’emails et Safari/PWA restent à valider après
configuration des ressources.
