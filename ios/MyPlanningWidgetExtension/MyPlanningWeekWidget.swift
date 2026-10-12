import WidgetKit
import SwiftUI
import AppIntents

struct MyPlanningConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "MyPlanning"
    static var description = IntentDescription("Affiche une semaine depuis ton lien calendrier privé MyPlanning.")

    @Parameter(title: "Lien calendrier privé")
    var calendarURL: String?
}

struct PlanningEvent: Hashable {
    let start: Date
    let end: Date?
    let title: String
    let allDay: Bool
}

struct PlanningDay: Identifiable {
    let date: Date
    let events: [PlanningEvent]
    var id: Date { date }
}

struct PlanningEntry: TimelineEntry {
    let date: Date
    let days: [PlanningDay]
    let message: String?
}

enum MyPlanningFeed {
    static var paris: TimeZone { TimeZone(identifier: "Europe/Paris") ?? .current }

    static func normalizedURL(_ value: String?) -> URL? {
        guard var raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if raw.lowercased().hasPrefix("webcal://") {
            raw = "https://" + raw.dropFirst("webcal://".count)
        }
        guard let url = URL(string: raw),
              url.scheme == "https",
              url.host == "myplanning.v76y74m25h.workers.dev",
              url.path.hasPrefix("/calendar/"),
              url.path.hasSuffix(".ics") else { return nil }
        return url
    }

    static func unescape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\n", with: "\n")
            .replacingOccurrences(of: "\\,", with: ",")
            .replacingOccurrences(of: "\\;", with: ";")
            .replacingOccurrences(of: "\\\\", with: "\\")
    }

    static func parseDate(_ value: String, allDay: Bool) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = paris
        formatter.dateFormat = allDay ? "yyyyMMdd" : "yyyyMMdd'T'HHmmss"
        return formatter.date(from: value)
    }

    static func parse(_ text: String) -> [PlanningEvent] {
        let lines = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)

        var inside = false
        var values: [String: String] = [:]
        var result: [PlanningEvent] = []

        func finish() {
            guard let startRaw = values["DTSTART"],
                  let titleRaw = values["SUMMARY"] else {
                values = [:]
                return
            }
            let allDay = values["DTSTART_ALLDAY"] == "1"
            guard let start = parseDate(startRaw, allDay: allDay) else {
                values = [:]
                return
            }
            let end = values["DTEND"].flatMap { parseDate($0, allDay: values["DTEND_ALLDAY"] == "1") }
            result.append(PlanningEvent(start: start, end: end, title: unescape(titleRaw), allDay: allDay))
            values = [:]
        }

        for line in lines {
            if line == "BEGIN:VEVENT" {
                inside = true
                values = [:]
                continue
            }
            if line == "END:VEVENT" {
                if inside { finish() }
                inside = false
                continue
            }
            guard inside, let separator = line.firstIndex(of: ":") else { continue }
            let keyPart = String(line[..<separator])
            let value = String(line[line.index(after: separator)...])
            if keyPart.hasPrefix("DTSTART") {
                values["DTSTART"] = value
                values["DTSTART_ALLDAY"] = keyPart.contains("VALUE=DATE") ? "1" : "0"
            } else if keyPart.hasPrefix("DTEND") {
                values["DTEND"] = value
                values["DTEND_ALLDAY"] = keyPart.contains("VALUE=DATE") ? "1" : "0"
            } else if keyPart == "SUMMARY" {
                values["SUMMARY"] = value
            }
        }
        return result
    }

    static func startOfWeek(containing date: Date) -> Date {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = paris
        return calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? calendar.startOfDay(for: date)
    }

    static func makeDays(events: [PlanningEvent], now: Date = Date()) -> [PlanningDay] {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = paris
        let start = startOfWeek(containing: now)
        return (0..<7).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: offset, to: start),
                  let next = calendar.date(byAdding: .day, value: 1, to: day) else { return nil }
            let items = events.filter { $0.start >= day && $0.start < next }.sorted { $0.start < $1.start }
            return PlanningDay(date: day, events: items)
        }
    }

    static func load(url: URL) async throws -> [PlanningEvent] {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        guard let text = String(data: data, encoding: .utf8) else {
            throw URLError(.cannotDecodeContentData)
        }
        return parse(text)
    }
}

struct Provider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> PlanningEntry {
        PlanningEntry(date: Date(), days: sampleDays(), message: nil)
    }

    func snapshot(for configuration: MyPlanningConfiguration, in context: Context) async -> PlanningEntry {
        if context.isPreview {
            return PlanningEntry(date: Date(), days: sampleDays(), message: nil)
        }
        return await entry(for: configuration)
    }

    func timeline(for configuration: MyPlanningConfiguration, in context: Context) async -> Timeline<PlanningEntry> {
        let current = await entry(for: configuration)
        let next = Date().addingTimeInterval(30 * 60)
        return Timeline(entries: [current], policy: .after(next))
    }

    private func entry(for configuration: MyPlanningConfiguration) async -> PlanningEntry {
        guard let url = MyPlanningFeed.normalizedURL(configuration.calendarURL) else {
            return PlanningEntry(date: Date(), days: MyPlanningFeed.makeDays(events: []), message: "Configure le lien privé MyPlanning.")
        }
        do {
            let events = try await MyPlanningFeed.load(url: url)
            return PlanningEntry(date: Date(), days: MyPlanningFeed.makeDays(events: events), message: nil)
        } catch {
            return PlanningEntry(date: Date(), days: MyPlanningFeed.makeDays(events: []), message: "Impossible d’actualiser le planning.")
        }
    }

    private func sampleDays() -> [PlanningDay] {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = MyPlanningFeed.paris
        let start = MyPlanningFeed.startOfWeek(containing: Date())
        let samples = [("13:00", "18:30"), ("06:30", "13:00"), ("06:30", "13:45"), ("13:30", "20:30")]
        return (0..<7).compactMap { i in
            guard let date = calendar.date(byAdding: .day, value: i, to: start) else { return nil }
            guard i < samples.count else { return PlanningDay(date: date, events: []) }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = MyPlanningFeed.paris
            formatter.dateFormat = "yyyy-MM-dd HH:mm"
            let dateFormatter = DateFormatter()
            dateFormatter.locale = Locale(identifier: "en_US_POSIX")
            dateFormatter.timeZone = MyPlanningFeed.paris
            dateFormatter.dateFormat = "yyyy-MM-dd"
            let day = dateFormatter.string(from: date)
            let startDate = formatter.date(from: day + " " + samples[i].0) ?? date
            let endDate = formatter.date(from: day + " " + samples[i].1)
            return PlanningDay(date: date, events: [PlanningEvent(start: startDate, end: endDate, title: "Travail", allDay: false)])
        }
    }
}

struct MyPlanningWeekView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PlanningEntry

    private var calendar: Calendar {
        var value = Calendar(identifier: .iso8601)
        value.timeZone = MyPlanningFeed.paris
        return value
    }

    private func weekday(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.timeZone = MyPlanningFeed.paris
        formatter.dateFormat = "EE"
        return formatter.string(from: date).replacingOccurrences(of: ".", with: "").uppercased()
    }

    private func dayNumber(_ date: Date) -> String {
        String(calendar.component(.day, from: date))
    }

    private func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.timeZone = MyPlanningFeed.paris
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    private func compactText(_ day: PlanningDay) -> String {
        guard let first = day.events.first else { return "—" }
        if first.allDay { return first.title }
        let primary = first.end.map { time(first.start) + "–" + time($0) } ?? time(first.start)
        return day.events.count > 1 ? primary + " +" + String(day.events.count - 1) : primary
    }

    private var weekTitle: String {
        guard let first = entry.days.first, let last = entry.days.last else { return "Ma semaine" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.timeZone = MyPlanningFeed.paris
        formatter.dateFormat = "d MMM"
        return formatter.string(from: first.date) + " – " + formatter.string(from: last.date)
    }

    var body: some View {
        Group {
            if let message = entry.message {
                VStack(alignment: .leading, spacing: 8) {
                    Label("MyPlanning", systemImage: "calendar")
                        .font(.headline)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("Maintiens le widget → Modifier le widget")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else if family == .systemLarge {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Ma semaine").font(.headline)
                        Spacer()
                        Text(weekTitle).font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(entry.days) { day in
                        HStack(spacing: 10) {
                            Text(weekday(day.date)).font(.caption.bold()).frame(width: 34, alignment: .leading)
                            Text(dayNumber(day.date)).font(.headline).frame(width: 24)
                            if day.events.isEmpty {
                                Text("Libre").foregroundStyle(.secondary)
                            } else {
                                VStack(alignment: .leading, spacing: 2) {
                                    ForEach(Array(day.events.prefix(2).enumerated()), id: \.offset) { _, event in
                                        Text(event.allDay ? event.title : (time(event.start) + (event.end.map { " – " + time($0) } ?? "")))
                                            .font(.subheadline.weight(.semibold))
                                    }
                                }
                            }
                            Spacer()
                        }
                        .padding(.vertical, 2)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Ma semaine").font(.headline)
                        Spacer()
                        Text(weekTitle).font(.caption2).foregroundStyle(.secondary)
                    }
                    HStack(alignment: .top, spacing: 4) {
                        ForEach(entry.days) { day in
                            let today = calendar.isDateInToday(day.date)
                            VStack(spacing: 5) {
                                Text(weekday(day.date).prefix(1))
                                    .font(.caption2.bold())
                                    .foregroundStyle(.secondary)
                                Text(dayNumber(day.date))
                                    .font(.headline)
                                Text(compactText(day))
                                    .font(.system(size: 9, weight: .semibold))
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.7)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                            .background(today ? Color.white.opacity(0.12) : Color.clear)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
            }
        }
        .containerBackground(for: .widget) {
            LinearGradient(
                colors: [Color(red: 0.05, green: 0.08, blue: 0.16), Color(red: 0.08, green: 0.12, blue: 0.22)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .widgetURL(URL(string: "https://myplanning.v76y74m25h.workers.dev/"))
    }
}

@main
struct MyPlanningWeekWidget: Widget {
    let kind = "MyPlanningWeekWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: MyPlanningConfiguration.self, provider: Provider()) { entry in
            MyPlanningWeekView(entry: entry)
        }
        .configurationDisplayName("Ma semaine MyPlanning")
        .description("Affiche les horaires MyPlanning de la semaine.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
