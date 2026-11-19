# Sudoku

Interaktywne sudoku w stylu sudoku.com: 6 poziomów trudności + odblokowywany tryb **GOD**,
notatki ołówkiem, timer, błędy i wynik, sterowanie klawiaturą, motywy (także własny),
wybór czcionki i rozmiaru cyfr, dźwięki oraz tryb skupienia.

**Tryb GOD:** najtrudniejsze plansze, bez podświetlania tych samych cyfr i bez pauzy.
Odblokowuje się po 5 ukończonych grach na poziomie Ekstremalny na swoim koncie.

**Zagraj:** https://igit418.github.io/sudoku/

## Skróty klawiszowe

| Klawisz | Działanie |
|---|---|
| Strzałki | ruch po planszy |
| 1–9 | wpisz cyfrę |
| Spacja | ołówek (notatki) ON/OFF |
| Shift + 1–9 | szybka notatka |
| Backspace / Delete | wymaż |
| Ctrl + Z | cofnij |
| H | podpowiedź |
| P | pauza |
| T | następny motyw |
| N | nowa gra |
| F | tryb skupienia |
| M | menu boczne |
| ? | lista skrótów |

## Konta graczy

Rejestracja e-mailem i hasłem z potwierdzeniem przez link, logowanie, reset i zmiana hasła,
zmiana e-maila, usuwanie konta oraz panel admina – na [Supabase](https://supabase.com).
Konfiguracja: [KONFIGURACJA.md](KONFIGURACJA.md).

## Pliki

| Plik | Co to |
|---|---|
| `index.html` | cała gra (jeden plik) |
| `src/accounts-supabase.js` | moduł kont – źródło, wklejony do `index.html` |
| `supabase/setup.sql` | skrypt bazy danych do wklejenia w SQL Editor |
| `supabase/email-templates/` | polskie szablony e-maili |
