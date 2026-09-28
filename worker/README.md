# MyPlanning AI Worker

Backend Vision de MyPlanning, déployé sur le Worker Cloudflare existant `myplanning`.
Le frontend/PWA reste publié sur GitHub Pages, sans changement de design ni de version.

## Cloudflare Workers Builds

Conserver ces réglages pour le dépôt `Clemen5t/MyPlanning` :

| Réglage | Valeur |
| --- | --- |
| Branche de production | `main` |
| Root directory | `/` (racine du dépôt) |
| Build command | aucune |
| Deploy command | `npx wrangler deploy` |

Le fichier `wrangler.toml` à la racine pointe explicitement vers `worker/worker.js`.
Il ne déclare aucun répertoire `assets` : Cloudflare déploie le backend, pas les
fichiers du dépôt. Ne pas ajouter `assets.directory = "."` ni de configuration
`wrangler.json` / `wrangler.jsonc` concurrente à la racine.

La configuration `worker/wrangler.toml` reste utilisable pour un lancement manuel
depuis `worker/`. Workers Builds doit utiliser celle de la racine.

Pour vérifier le bundle sans publier, depuis la racine :

```sh
npx wrangler deploy --dry-run
```

## Secret Cloudflare

Conserver `GROQ_API_KEY` dans **myplanning → Settings → Variables and Secrets**,
avec le type **Secret**. Le code l'utilise via `env.GROQ_API_KEY`.
Ne jamais copier sa valeur dans GitHub, le frontend ou une section `[vars]`.
Le déploiement cible le même Worker et n'ajoute, ne remplace ni ne supprime ce secret.

## Vérification

Après un build réussi :

```sh
curl -i https://myplanning.v76y74m25h.workers.dev/health
```

Réponse attendue : HTTP 200, de type JSON, avec :

```json
{"ok":true,"service":"MyPlanning AI","version":"0.1","vision":"Groq"}
```

Routes :
- `GET /health`
- `POST /scan` avec `{"employee":"BORELLO","image":"data:image/jpeg;base64,..."}`

`/health` confirme que le code du Worker s'exécute ; cette route n'appelle pas Groq.
Un `POST /scan` avec `{}` doit répondre HTTP 400 `Image manquante` si le secret
est présent, sans appel à Groq. HTTP 500 `GROQ_API_KEY absente du Worker`
signale un secret manquant.

La publication frontend **v0.06** reste conditionnée à un test Vision complet
avec une vraie photo : photo → Worker → Groq → JSON de planning exploitable.
