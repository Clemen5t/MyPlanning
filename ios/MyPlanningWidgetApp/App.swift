import SwiftUI

@main
struct MyPlanningWidgetHostApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("MyPlanning")
                        .font(.largeTitle.bold())

                    Text("Widget de la semaine")
                        .font(.title2.bold())

                    Text("Le widget lit le même lien privé que la synchronisation Calendrier. Aucun mot de passe MyPlanning n'est enregistré dans l'app.")

                    VStack(alignment: .leading, spacing: 10) {
                        Label("Dans MyPlanning : Réglages → Calendrier iPhone → Copier le lien.", systemImage: "1.circle.fill")
                        Label("Ajoute le widget MyPlanning sur l'écran d'accueil.", systemImage: "2.circle.fill")
                        Label("Maintiens le widget → Modifier le widget → colle le lien privé.", systemImage: "3.circle.fill")
                    }
                    .font(.body)

                    Text("Le lien est secret : toute personne qui le possède peut lire ton planning. Tu peux le révoquer depuis MyPlanning à tout moment.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Link("Ouvrir MyPlanning", destination: URL(string: "https://myplanning.v76y74m25h.workers.dev/")!)
                        .buttonStyle(.borderedProminent)
                }
                .padding(24)
            }
            .navigationTitle("MyPlanning")
        }
    }
}
