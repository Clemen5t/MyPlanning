# MyPlanning

Application PWA personnelle pour gérer un planning de travail type Skello : semaines, journées coupées, pauses, repos, congés, statistiques et exports.

## Fonctions V1

- Vue semaine lundi → dimanche
- Plusieurs créneaux par jour
- Pause non payée par créneau
- Repos / congé / arrêt / formation
- Calcul du total jour, semaine et mois
- Objectif hebdomadaire configurable
- Écart par rapport au contrat
- Estimation du brut mensuel avec taux horaire optionnel
- Vue calendrier mensuel
- Statistiques sur 6 mois
- Export `.ics` vers Apple Calendar / Google Calendar / Outlook
- Sauvegarde et restauration JSON
- PWA installable sur iPhone et Android
- Données conservées uniquement dans `localStorage`

## Lancer en local

```bash
npm install
npm run dev
```

## Construire

```bash
npm run build
```

## Publier avec GitHub Pages

1. Envoyer ce projet sur la branche `main`.
2. Dans **Settings → Pages**, sélectionner **GitHub Actions** comme source.
3. Le workflow `.github/workflows/deploy-pages.yml` construit et publie automatiquement l'application.

Le code peut être public sans exposer les horaires personnels : ceux-ci sont enregistrés localement dans le navigateur et ne sont pas commités sur GitHub.
