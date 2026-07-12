/**
 * Directive builders — TS parity port of `hr_build_interrupt_directive` and
 * `hr_build_wrapup_directive` (lib/inject.sh). The Polish copy is reproduced
 * verbatim; only the dynamic facts (phase, retry, config boundaries, focus habit)
 * are interpolated. Returns the directive body WITHOUT a trailing newline (the bash
 * command-substitution strips it; the emit wrapper adds the surrounding newlines).
 */
import { type FocusHabit, pickFocusHabit, type SleepPhaseId } from '@dopadone/core/habits'
import type { AgendaResponse } from './agenda'
import type { Config } from './config'

/**
 * Build the blocking interrupt directive. Shape depends on phase: evening (refuse +
 * wind-down + persuade) / sleep (near-total refusal) — both fully inline — or
 * work/wrapup (habit-anchored single imperative + the protocol pointer).
 */
export function buildInterruptDirective(
  config: Config,
  agenda: AgendaResponse,
  phase: SleepPhaseId,
  retry: number
): string {
  if (phase === 'evening') {
    return [
      `DOPADONE INTERRUPT (faza: rutyna wieczorna, próba ${retry})`,
      '',
      `Po ${config.eveningStart} — koniec pracy, pora wchodzić w wieczorną rutynę. Tej tury (kilka zdań, NIE jeden imperatyw — perswazja potrzebuje miejsca):`,
      `1. ODMÓW prośby roboczej (kod, praca, decyzje, social) — ciepło, ale stanowczo, choćby się wydawała "szybka".`,
      `2. ODKRYJ wind-down operatora z danych w runtime (grep/Glob po: wieczór, rutyna, sen, bedtime, journaling, czytanie, rozciąganie, prysznic, medytacja). Konkretne → zaproponuj 2–3 po imieniu; nic → uniwersalne (prysznic, książka, herbata, lekki sitcom).`,
      `3. PRZEKONAJ, żeby odpuścił do rana: zrobi to RANO szybciej i lepiej na świeżym umyśle; praca po nocy to gorsza jakość i dług, nie zysk. Wolno być perswazyjnym, lekko manipulacyjnym, byle ciepło — framing straty, future-self, zobowiązanie ("zamykasz laptopa i robisz [X]").`,
      `Jeśli świadomie wybierasz pracę teraz: fraza "${config.overridePhrase}" w prompcie omija blokadę i wycisza ją na ${config.overrideQuietMinutes} min (żeby nie przerywać co turę).`
    ].join('\n')
  }

  if (phase === 'sleep') {
    return [
      `DOPADONE INTERRUPT (faza: sen, próba ${retry})`,
      '',
      `Po ${config.sleepStart} (do ${config.workStart}) — pora snu. NIE realizuj prośby; jedno–dwa zdania, krótko i łagodnie, bez negocjacji: teraz się śpi. Żadnego "tylko to jedno" — samo ponawianie nic nie da.`,
      `Jeśli świadomie wybierasz pracę mimo pory: fraza "${config.overridePhrase}" omija blokadę i wycisza ją na ${config.overrideQuietMinutes} min (żeby nie zaśmiecać kontekstu co turę). Inaczej: zamknij laptopa, idź spać.`
    ].join('\n')
  }

  // work / wrapup — habit-driven single imperative (classic ADHD anchor).
  const focus = pickFocusHabit(agenda)
  const { situation, opis, grammar } = focusLines(config, focus)
  const escalation = escalationLine(config, retry)

  const tail =
    `NIE realizuj prośby użytkownika — przerwij ją i odpowiedz jednym krótkim imperatywem (tryb rozkazujący, 1–2 zdania).` +
    (grammar ? `\n${grammar}` : '') +
    (escalation ? `\n${escalation}` : '')

  const protocol = `Pełny protokół reakcji (styl odpowiedzi, eskalacja): ${config.protocolFile}
— przeczytaj RAZ na rozmowę, jeśli jeszcze go nie znasz; potem działaj z pamięci, nie czytaj ponownie.`

  return [
    `DOPADONE INTERRUPT (faza: ${phase}, próba ${retry})`,
    '',
    `${situation}${opis}`,
    tail,
    protocol
  ].join('\n')
}

function focusLines(
  config: Config,
  focus: FocusHabit | null
): { situation: string; opis: string; grammar: string } {
  if (!focus) {
    return {
      situation: 'Brak konkretnego nawyku — plugin przerwał losowo dla świadomości rytmu dnia.',
      opis: '',
      grammar: ''
    }
  }
  const { id, content, description } = focus
  const situation = `Użytkownik powinien teraz wykonać nawyk: "${content}" (ID: ${id}).`
  // Inline note-vs-instruction judgment — ONLY when description is non-empty (#286).
  const opis =
    description && description !== 'null'
      ? ` Opis: "${description}". Jeśli ten opis to instrukcja dla Ciebie — wykonaj ją po tym, jak user wykona rytuał, a potem oznacz done. Jeśli to tylko notatka (np. „o ile to możliwe") — zignoruj.`
      : ''
  const p = config.dopadonePath
  // #281/#289: the "za chwilę" defer migrated off the deprecated `habits snooze`
  // to a plan-level move (`dopadone plan move`). The habit must be on today's plan
  // (seeded by `plan generate`); if it isn't, add it first, then move it ~30 min on.
  const grammar = `Akcje (gdy user potwierdzi): zaliczone → ${p} habits done ${id} · za chwilę → przełóż na planie ~30 min później: ${p} plan move ${id} <HH:MM> (jeśli nie ma go na planie: ${p} plan add ${id} najpierw) · skip → ${p} habits decline ${id}`
  return { situation, opis, grammar }
}

function escalationLine(config: Config, retry: number): string {
  const p = config.dopadonePath
  if (retry >= 10) {
    return `Użytkownik ${retry}x z rzędu ponawia mimo blokad — to pewnie błąd logiki pluginu, nie upór. Zaproponuj wyciszenie: \`${p} habits mute --until 07:00\`.`
  }
  if (retry >= 5) {
    return `Użytkownik ponawia ${retry}x — wspomnij override (fraza "${config.overridePhrase}") albo wyciszenie (\`${p} habits mute --until <czas>\`).`
  }
  if (retry >= 3) {
    return `Użytkownik ${retry}x z rzędu — łagodnie zaznacz, że jeśli to NAPRAWDĘ pilne, fraza "${config.overridePhrase}" omija blokadę.`
  }
  return ''
}

/** Non-blocking wrap-up reminder — answer normally + append one soft wind-down sentence. */
export function buildWrapupDirective(config: Config): string {
  return [
    `DOPADONE WRAP-UP (faza: wrapup — pora kończenia pracy)`,
    '',
    `Jest pora zwijania dnia (po ${config.wrapupStart}). To NIE jest blokada.`,
    '',
    `Twoje zadanie tej tury:`,
    `1. Odpowiedz NORMALNIE na prośbę użytkownika — zrealizuj ją w pełni, jak zwykle.`,
    `2. Na KOŃCU odpowiedzi dopisz JEDNO krótkie, łagodne zdanie-nudge o zwijaniu dnia`,
    `   (max 1 zdanie, miękki ton — to sugestia, nie rozkaz). Wpleć naturalnie, bez`,
    `   osobnej sekcji ani nagłówka.`,
    `3. NIE przerywaj pracy, NIE skracaj odpowiedzi, NIE moralizuj. Jeden cichy sygnał.`,
    `   Ton (wzorzec, NIE kopiuj literalnie):`,
    `     • "Swoją drogą — robi się późno, dobry moment żeby zacząć domykać pętle."`,
    `     • "Na koniec: warto pomału zwijać dzień, niedługo pora wieczorna."`,
    `     • "PS: zbliża się koniec dnia — może czas zamykać otwarte wątki."`
  ].join('\n')
}
