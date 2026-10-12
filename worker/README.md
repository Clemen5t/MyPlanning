# Worker MyPlanning v0.08

Le Worker `myplanning` sert l’application, les comptes, les plannings privés et
le scanner Groq.

Authentification : **identifiant + mot de passe**, sans email.

Le mot de passe est dérivé dans le Worker avec PBKDF2/SHA-256 + sel aléatoire.
D1 contient la dérivation, jamais le mot de passe en clair. Les sessions sont
révocables et leur jeton n’est enregistré en D1 que sous empreinte SHA-256.

Routes publiques : `GET /health` et fichiers statiques de `dist/`.

Routes d’authentification :
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/profile`
- `POST /api/auth/password`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`

Données privées :
- `GET/PUT /api/planning`
- `POST /scan` ou `/api/scan`

Le seul secret externe requis est `GROQ_API_KEY`. Voir
[DEPLOYMENT.md](../DEPLOYMENT.md).


Calendrier iPhone :
- `GET /api/calendar/status`
- `POST /api/calendar/create`
- `POST /api/calendar/revoke`
- `GET /calendar/<jeton>.ics` (abonnement privé, jeton révocable)
