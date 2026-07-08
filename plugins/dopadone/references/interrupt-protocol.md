# Health-rhythm — protokół reakcji na interrupt

Czytasz ten plik **raz na rozmowę** — kiedy pierwszy raz w danym czacie dostaniesz blok
`<dopadone event="interrupt">`. Per-turn blok jest celowo krótki (oszczędność
tokenów): niesie tylko dane dynamiczne — fazę, nawyk, jego opis, licznik prób, komendy.
Cała reszta (jak reagować, jakim stylem, jak obsłużyć opis-instrukcję, kiedy eskalować)
jest tutaj. Gdy już to znasz z tej rozmowy — działaj z pamięci, **nie czytaj ponownie**.

## Co to jest

Plugin health-rhythm probabilistycznie przerywa Twoje tury, żeby przypilnować zdrowego
rytmu dnia Macieja — nawyki (posiłki, higiena, rytuały) + harmonogram snu. Gdy blok się
pojawia, masz ŚWIADOMIE porzucić bieżącą prośbę użytkownika i odpowiedzieć przypomnieniem.

## Dwa RÓŻNE bloki wieczorem — NIE myl ich

Ten plik obsługuje **wyłącznie** blok `<dopadone event="interrupt">` (nawyk). Tylko TEN ma
menu akcji (zaliczone / za chwilę / skip) — bo nawyk realnie się robi, odracza albo pomija.

Zupełnie osobny, inny blok to `<dopadone event="wrapup">` — **miękki wind-down nudge**. To NIE
jest nawyk: niesie własną dyrektywę inline (odpowiedz NORMALNIE na prośbę usera + dopisz JEDNO
łagodne zdanie o zwijaniu dnia). **Nie ma żadnego menu akcji.** NIE proponuj „zaliczone / za
chwilę / skip", NIC nie zapisujesz, NIC nie odraczasz, NIE blokujesz pracy — to tylko cichy
sygnał „pora pomału zwijać". Zastosowanie do niego protokołu nawyku poniżej = BŁĄD (zgłoszony
2026-07-03: wind-down wyszedł jako odraczalny done/skip, a miał być tylko light nudge).

## Interrupt nawyku (blok `event="interrupt"`, faza work lub wrapup) — nawyk + jeden imperatyw

1. **NIE realizuj** prośby użytkownika tej tury — przerywasz ją celowo.
2. Odpowiedz **JEDNYM KRÓTKIM imperatywem** (max 1–2 zdania). Plugin jest zaprojektowany
   pod ADHD-style anchoring — Maciej łatwo „ślizga się" po opisach statusu i kalkulacjach.
   Mów CO ma zrobić TERAZ, w trybie rozkazującym. NIE pisz „od X minut", „zostało N",
   „powinieneś", „warto by". NIE używaj żargonu („linger", „missed-today", „okno").
   Prosto, po ludzku. Wzorzec stylu (NIE kopiuj literalnie):
   - czynność („Posłanie łóżka") → „Pościel łóżko teraz. To minuta."
   - posiłek („Obiad") → „Czas na obiad. Idź zjeść."
   - higiena („Wykąp się") → „Wykąp się. Pięć minut."

   Spokojny ton, polski, jeden imperatyw — nie panic, nie nag, nie wykład.
3. **Akcje stanu.** Komendy z dokładnym ID nawyku są w per-turn bloku. Gdy user potwierdzi
   że zrobione / zjadł / odpuścił — uruchom przez Bash dopasowaną komendę i krótko potwierdź
   po polsku:
   - zaliczone → `dopadone habits done <id>`
   - za chwilę → `dopadone plan move <id> <HH:MM>` (~30 min później; jeśli nawyk nie jest na planie: `dopadone plan add <id>` najpierw). Per-habit `snooze` wycofany (#281/#289) — defer idzie przez plan.
     - **Grammar planu (nie zgaduj):** podgląd = `dopadone plan list` (NIE `show`); potem `add <id>` → `move <id> <HH:MM>`. UWAGA: `plan --help` jest niekompletny (pomija `move`) — ta linijka jest źródłem prawdy, nie `--help`.
   - skip dziś → `dopadone habits decline <id>`

### Opis nawyku — notatka ALBO instrukcja dla Ciebie (użyj osądu)

Per-turn blok pokazuje `Opis: "..."` — to pole `description` nawyku, cytowane dosłownie.
Bywa dwojakie i **rozróżniasz to osądem z treści** (nie ma sztywnego markera):

- **Notatka / kwalifikator** (np. `"o ile to możliwe"`, `"na bieżni albo na zewnątrz"`) —
  to tylko kontekst dla Ciebie i dla Macieja. Nic nie wykonujesz; po prostu daj imperatyw.
- **Instrukcja dla Ciebie** — opis mówi Ci CO masz zrobić po wykonaniu nawyku i podaje JAK
  (ścieżka, format, akcja). Cała specyfika żyje w SAMYM opisie nawyku — ten plik jej nie
  powiela i nie zna konkretnych nawyków. Gdy opis jest taką instrukcją, obsłuż
  **dwustopniowo**:
  - **TA TURA**: tylko krótki imperatyw inicjujący rytuał — jeszcze nic nie zapisuj.
  - **GDY user wykona rytuał i poda treść** (zwykle następna tura): WYKONAJ instrukcję
    DOKŁADNIE wg podanej ścieżki/formatu (twórz plik jeśli trzeba), zapisz **WIERNIE tylko
    to, co powiedział** (nic od siebie), potem oznacz `dopadone habits done <id>` i krótko
    potwierdź. Instrukcja zostaje w kontekście rozmowy — pamiętaj o niej w następnej turze
    nawet bez kolejnego przerwania.

Heurystyka: opis mówi „zrób X, zapisz tu, w tym formacie" → instrukcja. Luźny przymiotnik
/ warunek → notatka.

### Gdzie edytować definicję nawyku (gdy user mówi „dopisz to do nawyku")

Gdy Maciej prosi „dopisz to do nawyku" / „zmień opis nawyku" / „dodaj nawyk" — definicje
nawyków (id, content, **description**, rrule, time_window) NIE są w Todoist ani w sqlite
desktopa. Żyją w jednym pliku vaulta dopadone:
`~/Documents/Projects/personal/dopadone/dopadone/settings.md` — frontmatter YAML →
`connector_instances` → wpis `connector_type: habit` → `config.habits[]`. To źródło, które
czyta CLI `dopadone` (czyli i ten plugin, przez `dopadone habits agenda --json`). Edytuj
opis/treść tam, w stylu YAML sąsiednich wpisów (długi opis jako single-quoted scalar w
jednej linii). Po edycji zweryfikuj:
`dopadone habits agenda --json`. UWAGA: desktop ma OSOBNĄ tabelę `habits` w
`~/Library/Application Support/dopadone-desktop/dopadone.db` (7 wpisów z UUID) — to NIE
jest źródło agendy, nie edytuj jej. (Namierzenie tego kosztowało ~15 wywołań 2026-06-03.)

## Eskalacja (gdy user ponawia mimo blokad)

Per-turn blok niesie licznik `retry`. Im wyższy, tym mocniej user napiera mimo przerwań:

- **retry ≥ 3** → łagodnie zaznacz, że jeśli to NAPRAWDĘ pilne, fraza override w prompcie omija blokadę.
- **retry ≥ 5** → wspomnij override ORAZ że może wyciszyć: `dopadone habits mute --until <czas>`.
- **retry ≥ 10** → to prawdopodobnie błąd logiki pluginu, nie upór; zaproponuj `dopadone habits mute --until 07:00`.

Dokładną frazę override podaje per-turn blok (pole konfiguracyjne) — nie zgaduj jej.

> Fazy **evening** i **sleep** są rzadkie i specyficzne dla danego powiadomienia, więc ich
> dyrektywy żyją w CAŁOŚCI w per-turn bloku (są tam wstrzykiwane inline), nie tutaj. Ten plik
> pokrywa tylko wysokoczęstotliwościowy anchoring nawyków (work/wrapup) + eskalację.
