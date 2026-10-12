# Widget iPhone MyPlanning

Ce dossier contient le compagnon iOS natif nécessaire pour afficher un vrai widget
système sur l’écran d’accueil. Apple fournit les widgets via WidgetKit dans une
extension d’app ; la PWA MyPlanning ne peut pas publier elle-même un widget système.

## Utilisation

1. Dans MyPlanning web : Réglages → Calendrier iPhone → créer/copier le lien privé.
2. Installer l’IPA du compagnon iOS.
3. Ajouter le widget **Ma semaine MyPlanning** sur l’écran d’accueil.
4. Maintenir le widget → **Modifier le widget** → coller le lien calendrier privé.

Le widget ne reçoit jamais le mot de passe MyPlanning. Il lit uniquement le lien
calendrier privé révocable. Les formats moyen et grand affichent la semaine en
cours et actualisent le flux périodiquement selon le budget WidgetKit d’iOS.

## Build

Le projet est généré avec XcodeGen :

```sh
cd ios
xcodegen generate
xcodebuild -project MyPlanningWidget.xcodeproj -scheme MyPlanningWidgetApp -configuration Release -sdk iphoneos CODE_SIGNING_ALLOWED=NO
```

Le workflow GitHub `Build iPhone widget` produit un IPA non signé destiné à être
re-signé/ installé avec un outil de sideloading compatible, ou le projet peut être
signé directement dans Xcode avec un compte Apple Developer.
