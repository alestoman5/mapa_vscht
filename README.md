# Mapa VŠCHT – budovy A a B

Neoficiální mapa a navigace po budovách A a B VŠCHT Praha. Čistě statický web (bez buildu, bez závislostí), stavěný pro mobil.

## Spuštění

Stačí otevřít `index.html`, nebo složku servírovat jakýmkoli statickým serverem (např. GitHub Pages):

```bash
python3 -m http.server 8000
```

## Co umí

- 7 pater (2. suterén až 4. patro), posun, zoom a otáčení dvěma prsty
- hledání místností (`A136`, `BI`, `B1-410`…), odkaz přímo na místnost přes `#A136`
- trasa mezi místnostmi a vchody přes chodby, schodiště a výtahy, volba „bez schodů“
- Driver mode: parodie na autonavigaci – plyn, brzda, tempomat, hlasové pokyny, hlášení policie, nehod a dalších událostí
- jeden easter egg v 1. patře budovy A

## Soubory

- `data.js` – místnosti a dveře (předzpracováno z GeoJSON, souřadnice v cm, lokální počátek)
- `nav.js` – model, hledání a výpočet trasy (graf dveří + nejkratší cesty uvnitř místností)
- `app.js` – vykreslení na canvas, gesta, hledání, panel trasy
- `driver.js` – Driver mode

## Omezení dat

Typy místností jsou odhad z číselných kódů. Části místností v podkladech chybí dveře; ty jsou napojené na nejbližší chodbu náhradní spojnicí. Hlavní vchod A v datech dveří není, trasa začíná ve vstupní hale.
