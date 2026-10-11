# Worker MyPlanning v0.07

Le Worker existant `myplanning` sert maintenant l’application, les comptes et les
plannings privés, ainsi que `/scan` (Groq). Utiliser uniquement le `wrangler.toml`
à la racine du dépôt ; la configuration concurrente dans ce dossier a été retirée.

La configuration complète est dans [DEPLOYMENT.md](../DEPLOYMENT.md).
`GROQ_API_KEY` reste un secret du Worker existant, requis lors du déploiement.
D1, `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` doivent être préparés avant mise
en service. Aucune clé d’administration Supabase n’est nécessaire.

Routes publiques : `GET /health`, fichiers statiques autorisés de `dist/`.
Authentification : `/api/auth/register`, `confirm`, `login`, `session`,
`forgot-password`, `reset-password`, `profile`, `password`, `logout`, `logout-all`.
Données privées : `GET/PUT /api/planning`, `POST /scan` (alias `/api/scan`).

Les requêtes mutantes attendent `Origin` identique à l’API et JSON. Celles d’une
session existante demandent également `X-CSRF-Token`. Le serveur déduit le
propriétaire du cookie, jamais d’un paramètre `user_id` client. Les données ne
sont ni journalisées ni mises en cache. Le cron quotidien purge les données
techniques expirées sans supprimer les plannings.
