# Tankowanie

Version: v1.2.0

Mobile-first PWA for fast refueling entry. The Google Apps Script endpoint and PIN are configured locally in the app settings on the phone.

This public repository contains the installable PWA files only. Sheet-specific backend files and private project notes stay local.

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
```

E98 entry:

```text
row = 'zbiór danych E98'!N9
G{row} = odometer
H{row} = liters
I{row} = discounted price actually paid
T{row} = refueling date
```

Displayed monthly LPG result:

```text
'wprowadź tankowanie'!B17:C17
fallback/source: 'zbiór danych LPG'!BK8:BK9
```

Pump/display price is kept only in the phone app as a next-entry hint. The Sheet receives only the discounted price.

## Local Test

Serve the directory from a local HTTP server:

```powershell
python -m http.server 8787
```

Then open:

```text
http://localhost:8787/
```
