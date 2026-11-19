# Konfiguracja kont (Supabase) – krok po kroku

Wszystko robisz w panelu **supabase.com → Twój projekt**. Nazwy menu mogą się minimalnie różnić, bo Supabase czasem zmienia wygląd panelu.

## 1. Baza danych (jedno kliknięcie)

1. Po lewej: **SQL Editor** → **New query**.
2. Wklej całą zawartość pliku [`supabase/setup.sql`](supabase/setup.sql).
3. Kliknij **Run**. Powinien pojawić się komunikat *Success. No rows returned*.

Skrypt tworzy tabelę `profiles`, zabezpieczenia (każdy widzi tylko swoje konto, admin widzi wszystkie) i funkcje panelu admina. Konto **igor.kudlaty@gmail.com** automatycznie dostaje rolę admina.

## 2. Adresy strony

**Authentication → URL Configuration**

- **Site URL:** `https://igit418.github.io/sudoku/`
- **Redirect URLs** → *Add URL*: `https://igit418.github.io/sudoku/**`

Bez tego linki z e-maili prowadziłyby na zły adres.

## 3. Logowanie e-mailem

**Authentication → Sign In / Providers → Email**

- **Enable Email provider:** włączone
- **Confirm email:** włączone (nowe konto działa dopiero po kliknięciu linku z e-maila)
- **Secure email change:** włączone
- **Minimum password length:** `8`

Zapisz (**Save**).

## 4. Polskie e-maile

**Authentication → Emails → Templates** (lub *Email Templates*). Dla każdego szablonu wklej temat i treść (*Source*):

| Szablon | Temat (Subject) | Treść z pliku |
|---|---|---|
| Confirm signup | `Potwierdź konto w Sudoku` | [`confirm-signup.html`](supabase/email-templates/confirm-signup.html) |
| Reset password | `Ustaw nowe hasło w Sudoku` | [`reset-password.html`](supabase/email-templates/reset-password.html) |
| Change email address | `Potwierdź nowy adres e-mail – Sudoku` | [`change-email.html`](supabase/email-templates/change-email.html) |

Po rejestracji gracz dostaje e-mail z nazwą gracza, adresem i przyciskiem potwierdzenia. **Hasła nie wysyłamy nigdy** – Supabase przechowuje je tylko w zaszyfrowanej postaci.

## 5. Klucze dla strony

**Project Settings → API Keys** (lub przycisk **Connect** u góry):

- **Project URL** – wygląda jak `https://abcdefgh.supabase.co`
- **Publishable key** (`sb_publishable_…`) albo **anon public** key

Oba są **publiczne** i mogą być w kodzie strony. **Nigdy nie udostępniaj** klucza `service_role` / `secret` ani hasła do bazy.

## 6. Pierwsze logowanie admina

Wejdź na stronę → pasek z lewej (`M`) → **Zarejestruj się** adresem `igor.kudlaty@gmail.com` → kliknij link w e-mailu → zaloguj się. Pojawi się zakładka **Panel admina**.

## Limit e-maili

Wbudowana wysyłka Supabase ma niski limit wiadomości na godzinę i służy głównie do testów. Gdy graczy przybędzie, podłącz własny serwer pocztowy: **Authentication → Emails → SMTP Settings** (np. Gmail z hasłem aplikacji, Brevo, Resend).
