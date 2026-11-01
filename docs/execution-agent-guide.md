# Windows側の試料実行AI

受け取るのは [Sample Catalog](sample-request-spec.md) です。生成するJTDは正規の一太郎自身が保存します。標準経路はCatalog → validate → `ichitaro-request`（compile と全試料の実行、`--pdf` で PDF）→ `ichitaro-package` → 返却です。Recipe を1つずつ実行する `ichitaro-macro` は内部形式の経路で、互換性は保証しません。

## 1. 受け取りと検証

元の要求ファイルを保存し、プロジェクトのルートで実行します。

```powershell
node bin/ichitaro.mjs validate examples/agent/03-ruby.json
node bin/ichitaro.mjs compile examples/agent/03-ruby.json tmp/ruby-request
```

compileの出力先は**まだ存在しないディレクトリ**、その親は存在する必要があります。入力全体を検証してから書き始め、既存の出力は上書きしません。IOエラーで途中まで書かれた場合は、その出力を使わず新しいディレクトリに再コンパイルしてください。`compilation.json` は全ファイルの保存後に作られます。

出力は元要求の全フィールドを保った `request.json`、試料ごとの `<sample-id>.recipe.json`、対応表 `compilation.json` です。対応表はアプリ版・コンパイラ版、元要求とRecipeのSHA-256、`sampleId`・`outputSampleId`・`baselineSampleId` を保持します。入力JSONの空白等は正規化されるため、要求ハッシュは出力の `request.json` のハッシュです。

## 2. 計画と前提条件の確認

```powershell
node bin/ichitaro.mjs plan tmp/ruby-request/ruby-reading.recipe.json
```

1要求につきbaselineと要求試料の2つのJTDを計画します。本文の異なる要求も独立したRecipeとして処理します。`feature`以外の併用能力も対応表の `capabilities` に記録されます。

Windows・Node.js 22以上・ライセンス済み一太郎2026を用意します。各 `prerequisites`、フォント名、新規文書の横書き設定を実行環境で確認してください。生成側は既定用紙・既定フォント等の環境全体を固定しません。固定の初期レイアウト値はコンパイラの方針であり、OpenJTD側が操作順を指定するものではありません。既定40字/40行、字間1%、行間60%、各余白30mmを使い、実際の連動値を読み戻します。

## 3. 実行

```powershell
node bin/ichitaro-request.mjs examples/agent/03-ruby.json tmp/ruby-request runs --pdf
```

これは Catalog をコンパイルし、一太郎を起動して全試料の保存と再読込まで自動実行します。一太郎が既に起動していると、マクロを送らずに止まります（`ERR_ICHITARO_ALREADY_RUNNING`。閉じてから実行してください。`--allow-running-ichitaro` を付けると送りますが、開いている一太郎が残る限り全プロセスの終了を待てず、結果不明 `ERR_ICHITARO_STILL_RUNNING` で止まります。[マクロアダプタ](macro-adapter.md)）。別の場所の一太郎は `--exe` か `ICHITARO_EXE` で指定します（[マクロアダプタ](macro-adapter.md)）。画面操作は使いません。コンパイル済みの Recipe を1つだけ実行するときは `node bin/ichitaro-macro.mjs tmp/ruby-request/ruby-reading.recipe.json runs` を使えます（内部形式。Catalog そのものを渡さないでください）。

`ichitaro-request` は、コンパイル、全ジョブの逐次実行、各runの `verifyRun` 再検査を行い、出力ディレクトリの `execution-results.json` に各 `sampleId`・`runDir`・状態・JTDのSHA-256・整合性/完了の結果・`expectedEvaluation: "not-performed"` を記録します。マクロが完了し読み戻しだけが要求と一致しなかった試料（`reasonCode: READBACK_MISMATCH`、状態はsavedまたはfailed）は記録して次のジョブへ進みます。結果が不明なタイムアウト（`TIMEOUT_UNKNOWN_OUTCOME`）、マクロ自体のエラー（`MACRO_ERROR`、一太郎が開いたまま残る可能性がある）、runの整合性検査の失敗（`INTEGRITY_FAILED`）、baselineの不一致では残りを実行せずに止まります。全件がverifiedでない限り終了コードは非0です。

`execution-results.json`（schemaVersion 2）には、試料ごとに要求値、保存前と再読込後の文書レベルの実値（8数値・単位・方向・優先・フォント・用紙・段組書式・ページ番号）、差分、各proofの合否、本文の確かめ方（`bodyComparison`。例：`exact-text`、1文字ずつ読む `range-characters-and-joined-string`、2000字を超える本文の `long-text-joined-lines-and-paragraph-walk`。runのmanifestの `verification.bodyComparison` の写し）、範囲の注釈を1文字ずつ読んだ範囲（`rangeCoverage`。`verification.rangeProof.coverage` の写しで、2000字を超える本文では注釈を置いた段落だけ。注釈がなければ `null`）、JTD・manifest・マクロのパスとハッシュ、baselineの状態、保存の回数（baselineは新規文書の初回保存、試料はbaselineを開いて別名保存し、再読込後は保存せずに閉じる）を記録します。ハッシュはrunのmanifestに記録された値で、改めて計算したものではありません。一太郎の版は実行ファイルの製品名・SHA-256・更新日時で識別します（ファイルバージョンは1.0固定のため）。

`--pdf` を付けると、試料のJTDを検証した後、別のマクロ実行でそのJTDを開いてPDF形式（`SaveDocument` の保存形式23）で保存し、保存せずに閉じます。PDF保存の前後でJTDのハッシュが変わらないことを確認し、PDFはコンパイル出力ディレクトリの `pdf/` に置きます（runの証跡には入れません）。PDFの書き出しに失敗するとそこで止まり、`--pdf` のときはPDFのない試料が1件でもあれば `ok` は偽です（最後の試料のPDFの失敗も含む）。PDFの見た目は検証していません。

`repeat` の各ジョブは `requestSampleId` と `repeat` 番号、`control` を指定した試料は `control`（状態・JTD・差分）を結果に持ちます。対照の例は[公開例28](../examples/agent/28-repeat-control.json)と[実行結果](../tmp/public-repeat-control-20261015/execution-results.json)です。

このアプリが作っていない既存のJTDをPDFにするときは、Sample Catalogとは別の [PDF Catalog](../schemas/pdf-catalog.schema.json)（`kind: "pdf-from-jtd"`、[例](../examples/agent/33-pdf-from-jtd.json)）を `node bin/ichitaro-pdf.mjs <pdf-catalog.json> <input-directory> <new-output-directory>` で処理します。`<input-directory>` は `inputs/<名前>.jtd` を持つフォルダです。JTDは出力先の `jtd/` に写し、写しのSHA-256がCatalogの値と同じことを確かめてから、写しだけを一太郎で開きます（元のJTDは開きません）。1件ごとに別のマクロ実行で `WarningMode(0)` → 開く → `--pdf` と同じ `SaveDocument` の形式23 → シート数と文書マクロ数を記録 → 保存せずに閉じる、の順に行い、閉じた後の写しのハッシュを開く前と比べます。開けない・PDFにできない文書は理由（`outcome`）を記録して次へ進み、タイムアウト（ダイアログなどで結果が不明）では一太郎の窓の文言を読み取りだけで記録して止まります。`document.pdf` は、JTDを最後に保存したときのカレントシートだけを持ちます。シートが2つ以上ある文書は、同じマクロ実行の中でシートを左から順に切り替え、同じ形式23でシートごとのPDFも保存します（0.17.0以降）。結果は出力先の `execution-results.json`（`kind: "pdf-from-jtd"`）で、同じ `ichitaro-package.mjs` で受け渡し用に書き出せます（PDFは `documents/<id>/document.pdf` と、シートが2つ以上なら `sheet-<i>.pdf`。JTDは含めない）。

受け渡し用のディレクトリは `node bin/ichitaro-package.mjs <compile-directory> <new-package-directory>` で実験ストレージ（例：`output/`）に書き出します。各runを `verifyRun` で検査し、記録済みのハッシュとコピーのバイト列を照合して `package-manifest.json` に一覧します。zipは作りません。

```powershell
node bin/ichitaro-request.mjs examples/agent/13-character-decoration.json tmp/my-request runs
```複数の要求は対応表の `jobs` を順に処理し、同時実行はしません。実行前に要求・Recipeのハッシュを対応表と照合してください。編集が必要なら元Catalogを修正し再コンパイルします。

標準出力の `runDir` と `sampleId` の対応を保存します。要求JTDは `<runDir>/samples/<outputSampleId>/document.jtd`、基準JTDは `<runDir>/samples/baseline/document.jtd` です。対応表が指す元要求からpurpose、expected、tags等を取得できます。これらをRecipeに埋め込まないことで既存の厳密なRecipe形式との互換性を保ちます。

## 4. verify / report / 返却

```powershell
node bin/ichitaro.mjs verify "runs/<run-id>"
node bin/ichitaro.mjs report "runs/<run-id>"
```

各manifestの `status` / `verification` と、verifyの整合性検査を確認します。`verified` は一太郎の保存前・再読込後の取得値に基づきます。verifyはハッシュとサイズ等の整合性検査です。どちらもOpenJTDの解析結果や `expected` のPASSを意味しません。均等幅など、能力ごとの未検証項目も確認してください。

OpenJTD側へは `request.json`、`compilation.json`、要求JTD、baseline、runのmanifest・証跡・レポートを返します。報告には各 `sampleId`、`runDir`、JTDのパス・SHA-256、生成状態、verify結果、`expectedEvaluation: "not-performed"` を含めます。現段階では解析器を呼び出して期待値比較する機能はありません。複数runの逐次実行と結果の集約は `bin/ichitaro-request.mjs` が行います。Windows側AIが対応を記録します。

## エラーの扱い

- JSON/Schema/意味的検証の失敗: コードとpathを要求側に返し、修正を受け取ります。未知の能力を別能力へ自動置換しません。
- 環境・フォントの不足: prerequisite未充足として実行を止めます。validate成功を環境確認の代わりにしません。
- 保存後の不一致: `saved` と `verified` を区別し、不一致を報告します。残りの要求も一旦止めます。
- タイムアウト・結果不明: 自動再試行、ロック削除、強制終了はしません。自分の試験文書と実行プロセスを確認してから新runで再開します。[MacroAdapterの停止時の扱い](macro-adapter.md)を参照してください。

マクロ証跡に画面の画像はありません。画面を見て確かめたいことは、保存した JTD を一太郎で開いて人が確認します。
