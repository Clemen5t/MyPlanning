# MyPlanning

Application personnelle de planning inspirée de Skello, pensée pour une seule personne.

## V1

- Planning semaine lundi → dimanche
- Plusieurs créneaux dans une même journée
- Pauses non payées
- Repos, congé, arrêt, formation
- Objectif hebdomadaire configurable (25 h par défaut)
- Total jour / semaine / mois et écart avec l'objectif
- Statistiques sur 6 mois
- Estimation du salaire brut avec taux horaire optionnel
- Export calendrier `.ics`
- Sauvegarde / restauration JSON
- Installation PWA sur iPhone et Android
- Fonctionnement hors ligne
- Données stockées localement dans le navigateur

## Confidentialité

Le dépôt contient le code de l'application. Les horaires saisis restent dans le navigateur via `localStorage` et ne sont pas envoyés sur GitHub.

## Publication

Le workflow GitHub Actions `.github/workflows/deploy-pages.yml` publie automatiquement la branche `main` sur GitHub Pages une fois Pages configuré avec la source **GitHub Actions**.
