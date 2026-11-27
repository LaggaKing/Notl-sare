**Svenska** | [English](README.md)

# Notläsare

**Notläsare** är en helt lokal PDF-notläsare och anteckningsapp i stående format för kör- och sångnoter, byggd för repetitioner och konserter. Byggd med **Tauri v2**, **React**, **TypeScript**, **PDF.js** och **SQLite**.

> [!NOTE]
> **Windows Alpha-testversion (`v0.1.0-alpha.1`)**
> Notläsare är för närvarande i tidig publik testfas för **Windows 10/11 (x64)**. Rapportera gärna buggar eller synpunkter från repetitioner via GitHub Issue-formulären.

---

## Funktioner

- **Notbibliotek & smart filspårning**: Koppla lokala notmappar, importera enstaka PDF-filer, filtrera på stämma/taggar/favoriter och återkoppla flyttade eller omdöpta PDF-filer automatiskt via **SHA-256**-kontrollsummor.
- **Kör- och sånganteckningar**:
  - Frihandspenna och **överstrykningspenna**
  - **39 körspecifika stämplar** (dynamik, andningstecken, repriser, fermater, insatser, artikulation m.m.)
  - **Former** (linjer, pilar, rektanglar, ellipser) och **textanteckningar**
  - Flera **anteckningslager** som kan visas/döljas samt **ångra/gör om**
- **Läs- och konsertläge**:
  - **Automatisk beskärning** (tar bort vita marginaler) och **manuell beskärning**
  - **Halvsidig delning (split mode)** för smidiga sidbyten under konsert
  - Nyp- och hjulzoom, panorering, tryck-/svep-/tangentbordsbläddring samt **skärmlås (wake lock)** som håller Windows-skärmen vaken
- **Låtlistor & bokmärken**: Skapa konsert- och repetitionslistor med dra-och-släpp-sortering och hoppa snabbt till repetitionsmärken.
- **Repetitionsverktyg**:
  - **Konsertsäker metronom** (startar ljudlöst med enbart visuellt slag som standard, valfritt klickljud och tap tempo)
  - **Referenspiano** (justerbar stämton `438–444 Hz`, svensk `H`/`B`- eller engelsk `B`/`Bb`-benämning)
- **Export & säkerhetskopiering**:
  - Exportera noter med inbakade anteckningar som **PDF**
  - **JSON-säkerhetskopia och återställning** för bibliotek, anteckningar, bokmärken, låtlistor och inställningar
- **Tvåspråkigt gränssnitt**: Fullt stöd för **svenska** och **engelska**.

---

## Windows Alpha-nedladdning & SmartScreen-information

Färdiga Windows-installationspaket för `v0.1.0-alpha.1` finns under GitHub Releases:
- `Notlasare_v0.1.0-alpha.1_x64-setup.exe` (NSIS-installer)
- `Notlasare_v0.1.0-alpha.1_x64.msi` (MSI-installer)
- `SHA256SUMS.txt` (SHA-256-kontrollsummor)

### Windows SmartScreen-varning (osignerade alfaversioner)

Alfaversionerna är ännu **inte kodsignerade** med ett kommersiellt certifikat. Första gången du kör installationsfilen kan Windows Defender SmartScreen visa *"Windows skyddade din dator"*:

1. Verifiera den nedladdade filens SHA-256-kontrollsumma mot `SHA256SUMS.txt` (se nedan).
2. Klicka på **Mer information** i SmartScreen-rutan och välj **Kör ändå**.

### Verifiera `SHA256SUMS.txt` (PowerShell)

Lägg installationsfilen och `SHA256SUMS.txt` i samma mapp och kör:

```powershell
Get-FileHash .\Notlasare_v0.1.0-alpha.1_x64-setup.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Kontrollera att kontrollsumman stämmer överens med motsvarande rad i `SHA256SUMS.txt` (skiftlägesokänsligt).

---

## Integritet & säkerhetsmodell

Notläsare är byggd för att vara helt lokal och privat under repetitioner och konserter:

- **100 % offline & lokalt**: Ingen telemetri, ingen spårning, inga externa typsnitt/CDN-anrop och ingen nätverkskommunikation.
- **Härdad Rust-dialog-IPC**:
  - Inget obegränsat Tauri `assetProtocol` (`**`) och ingen bred filsystemstillgång från WebView.
  - Systemets fil- och mappdialoger öppnas direkt från Rust-kommandon, och PDF-läsning/export kontrollerar `.pdf`-ändelse, `%PDF-`-signatur, avvisar UNC-/enhetssökvägar samt tillämpar strikta storleksgränser.
  - Alla anteckningar, låtlistor, bokmärken och inställningar lagras lokalt i SQLite (`%LOCALAPPDATA%\Notlasare\notlasare.db`).

Se [SECURITY.md](SECURITY.md) för mer information om säkerhetsarkitekturen och hur säkerhetsproblem rapporteras.

---

## Bygga från källkod (Windows)

### Förutsättningar

- **Node.js 22+** och `npm`
- **Rust** (stabil verktygskedja med `clippy`)
- **Tauri v2-förutsättningar för Windows**: Microsoft Visual Studio C++ Build Tools (MSVC) och WebView2 Runtime (förinstallerat i Windows 11 och de flesta Windows 10-installationer)

> [!TIP]
> **Viktigt tips för Windows-sökvägar med å/ä/ö (`Notläsare`)**
> Om sökvägen till din lokala mapp innehåller icke-ASCII-tecken (som `ä` i `Notläsare`) kan MSVC/WiX/NSIS-byggskript misslyckas när Cargo bygger i `src-tauri/target`. Sätt `CARGO_TARGET_DIR` till en ren ASCII-sökväg innan du kör `cargo` eller `tauri`:
> ```powershell
> $env:CARGO_TARGET_DIR = "$env:LOCALAPPDATA\Notlasare-cargo-target"
> ```
> (Eller t.ex. `C:\temp\notlasare-target`.)

### Kommandon

```powershell
# Installera beroenden för frontend
npm ci

# Kör kontroller
npm run typecheck
npm test
npm run build

# Kör Rust-tester och Clippy (i src-tauri)
pushd src-tauri
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
popd

# Starta utvecklingsläge eller bygg Windows-installationspaket
npx tauri dev
npx tauri build
```

---

## Licens

Licensierad under [MIT-licensen](LICENSE).
