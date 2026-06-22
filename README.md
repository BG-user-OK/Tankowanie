# Tankowanie

Version: v2.0.1

Mobile-first PWA for fast refueling entry. The Google Apps Script endpoint and PIN are configured locally in the app settings on the phone.

This public repository contains the installable PWA files only. Sheet-specific backend files and private project notes stay local.

## Apps Script URL

Use one stable Web App URL whenever possible. After changing `Code.gs`, open Apps Script and use:

```text
Deploy > Manage deployments > edit existing Web App > select new version > Deploy
```

Do not create a new Web App deployment unless you intentionally want a new `/macros/s/.../exec` URL.

## Data Contract

Discount:

```text
'wprowadź tankowanie'!G2
```

LPG entry:

```text
row = 'zbiór danych LPG'!AS9
AL{row} = odometer
AM{row} = liters
AN{row} = discounted price actually paid
AY{row} = refueling date
AT{row} = receipt scan Drive link
```

E98 entry:

```text
row = 'zbiór danych E98'!N9
G{row} = odometer
H{row} = liters
I{row} = discounted price actually paid
T{row} = refueling date
```

Refueling dates are sent as `YYYY-MM-DD` and written as real Google Sheets dates formatted as `yyyy-mm-dd`, without a time component.

Displayed monthly LPG result:

```text
'aktualne spalanie LPG'!BK9
```

For E98, the monthly result in the app follows the latest E98 consumption because gasoline is refueled about once per month.

Pump/display price is kept only in the phone app as a next-entry hint. The Sheet receives only the discounted price.

The app config response also returns recent completed refueling data separately for LPG and E98, including odometer, liters, date, distance, and consumption. The phone uses that history for `Dziś`, `Poprzednie`, and distance hints. Sheet values overwrite provisional local values after fetch/sync.

## Receipt Scans

After an LPG save the app asks whether to add a receipt scan. Choose `MOŻE PÓŹNIEJ` when gasoline will be added to the same printed receipt, then use the yellow cloud button after taking the E98 entry.

Scans are stored locally until both conditions are true:

```text
photo exists
LPG row exists in the Sheet
```

The Apps Script backend uploads scans to Google Drive folder:

```text
Potwierdzenia_skany
```

and writes the shared file link to:

```text
'zbiór danych LPG'!AT{row}
```

Receipt scan handling is backend-only. Drive folder IDs and authorization data are not published in the public Git repository.

## Sound Assets

Optional click sounds live in:

```text
dzwieki/klawisze_numeryczne.wav
dzwieki/pola_tankowania.wav
dzwieki/pozostale_funkcje.wav
```

The app also tries `.mp3` and `.ogg` with the same base names. Missing sound files are ignored by the app.

## Graphic Assets

Fuel and footer graphics live in:

```text
grafiki/LPG.png
grafiki/E98.png
grafiki/Orlen-flota.jpg
```

## Local Test

Serve the directory from a local HTTP server:

```powershell
python -m http.server 8787
```

Then open:

```text
http://localhost:8787/
```
