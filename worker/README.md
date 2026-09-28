# MyPlanning AI Worker

Backend Vision de MyPlanning. Déploiement Cloudflare Workers depuis ce dossier.

Secret requis côté Cloudflare : `GROQ_API_KEY` (ne jamais le mettre dans GitHub).

Routes :
- `GET /health`
- `POST /scan` avec `{"employee":"BORELLO","image":"data:image/jpeg;base64,..."}`
