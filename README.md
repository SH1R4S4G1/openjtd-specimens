# openjtd-specimens

一太郎 2026 で JTD 試料を作る非公式ツールです。[OpenJTD](https://github.com/OpenJTD)（一太郎 JTD の解析器）の検証のために、「どんな文書が欲しいか」を書いた Sample Catalog から、設定を統制した JTD と PDF を一太郎自身に作らせ、保存前と再読込後の読み戻しで要求どおりかを照合して記録します。画面のクリックやキー入力は使わず、一太郎の文書化された `/M/` 起動と Sprint マクロ機能で文書を作ります（そのほかに行うのは、起動中かどうかの確認と、タイムアウト時に一太郎の窓の文言を読み取ることだけです）。

> 本ツールは個人が開発した非公式ツールであり、株式会社ジャストシステムとは関係ありません。同社による承認・保証・サポートはありません。「一太郎」は株式会社ジャストシステムの登録商標です。
>
> 本ツールには一太郎本体・マニュアル・ヘルプは含まれていません。利用にはライセンスを受けた一太郎が必要です。一太郎の使用許諾契約に従って利用してください。
>
> 本ツールは一太郎を起動・終了して試料文書を作成します。実行中は一太郎で作業しないでください。

## OpenJTD との関係

- このツールは OpenJTD 組織のプロジェクトではなく、個人のツールです。組織の rjtd・spec・corpus とは別に保守しています。
- OpenJTD 組織の corpus に出す試料は、このツールで作り、元になった Sample Catalog（または PDF Catalog）を出所として添えます。Sample Catalog なら、試料と照らし合わせて同じ設定の試料を一太郎で作り直せます。PDF Catalog は、どの JTD から PDF を作ったかの記録です（入力の JTD は Catalog を書く側が用意します）。
- このリポジトリの Issue で受け付けるのは、作れる能力の追加の提案と不具合の報告です。作れる能力は [capabilities.json](capabilities.json) に、Sample Catalog の書き方は[仕様](docs/sample-request-spec.md)・[JSON Schema](schemas/sample-catalog.schema.json)・[例](examples/agent)にあります。

## 読者別の入口

| 読者 | 最初に読むもの |
|---|---|
| 試料を要求する人・AI | [Sample Catalog 仕様](docs/sample-request-spec.md)、[JSON Schema](schemas/sample-catalog.schema.json)、[機械可読の能力一覧](capabilities.json)、[完成例](examples/agent)。既存の JTD を PDF にするときは [PDF Catalog](schemas/pdf-catalog.schema.json)（使い方は[実行ガイド](docs/execution-agent-guide.md)） |
| Windows で試料を作る人・AI | この README の「必要な環境」「試料を作る」と[実行ガイド](docs/execution-agent-guide.md) |
| このツールの開発者 | [開発者ガイド](docs/developer-guide.md)（Source of Truth、検査、内部形式、資料一覧） |

Catalog の検証とコンパイルは macOS や Linux でもできます。一太郎が必要なのは生成のときだけです。

```sh
node bin/ichitaro.mjs validate examples/agent/03-ruby.json
node bin/ichitaro.mjs compile examples/agent/03-ruby.json tmp/ruby-request
```

## 必要な環境

- Windows、Node.js 22 以上。外部 npm パッケージは不要です（`npm install` は要りません）。
- ライセンス済みの一太郎 2026（TARO36）。既定の実行ファイルは `C:/Program Files (x86)/JustSystems/TARO36/taro36.exe` です。別の場所にインストールした場合は、一太郎を起動するコマンドに `--exe <taro36.exe>` を付けるか、環境変数 `ICHITARO_EXE` で指定します。ファイルがなければ起動前に止まります。
- 通常のデスクトップ権限。一太郎を起動するため、sandbox からの実行では子プロセスが消えることがあります。

一台の Windows PC で CLI として使う想定です。

## 試料を作る

プロジェクトのルートで実行します。Catalog を検証し、コンパイルし、全試料を順に作って PDF も書き出し、受け渡し用のフォルダにまとめます。

```powershell
mkdir tmp, output
node bin/ichitaro.mjs validate examples/agent/03-ruby.json
node bin/ichitaro-request.mjs examples/agent/03-ruby.json tmp/ruby-request runs --pdf
node bin/ichitaro-package.mjs tmp/ruby-request output/ruby-request
```

`tmp/ruby-request` と `output/ruby-request` は新しいディレクトリで（既にあれば失敗します）、その親 `tmp/`・`output/` は作っておきます。どちらも git では追跡しません。

- `validate` は Schema・能力・意味的制約を検査します。一太郎は起動しません。
- `ichitaro-request` は Catalog を内部形式の Recipe にコンパイルし（出力先は新しいディレクトリ）、試料ごとに一太郎を起動して基準文書と要求文書の 2 つの JTD（対照を指定した試料では 3 つ）を作り、読み戻しを照合し、`--pdf` で JTD を PDF にも保存します。結果は `tmp/ruby-request/execution-results.json` に、各 run は `runs/<run-id>/` にできます。読み戻しが一致しなかった試料は記録して次へ進み、結果不明のタイムアウトやマクロのエラーでは止まります。全件が `verified` でなければ、また `--pdf` で PDF の付かない試料があれば、終了コードは 0 以外です。
- `ichitaro-package` は run を再検証し、JTD・PDF・記録を一つのフォルダに写して `package-manifest.json` を付けます。これが OpenJTD 側へ渡す単位です。

既存の JTD（このツールが作っていない文書）を PDF にするときは、PDF Catalog を `node bin/ichitaro-pdf.mjs <pdf-catalog.json> <input-directory> <new-output-directory>` で処理します（[実行ガイド](docs/execution-agent-guide.md)）。

各 run の `samples/<sample-id>/` には、一太郎が保存した `document.jtd`、要求値・観測値・検証結果・ハッシュを持つ `manifest.json`、マクロソースと一太郎が返した結果の `evidence/` があり、run 直下の `index.html` がレポートです。記録の整合性は再検査できます。

```powershell
node bin/ichitaro.mjs verify "runs/<run-id>"
node bin/ichitaro.mjs report "runs/<run-id>"
```

`verify` は記録された SHA-256 とサイズを実ファイルから再計算し、改変や欠落を検出します。ハッシュだけで、一太郎自体の正しさや記録の真正性を証明するものではありません。マクロ経路はスクリーンショットを取得しないため `hasScreenshot` は `false` です。

## 実行時の注意

- 一太郎が既に起動していると、既定ではマクロを送らずに止まります（`ERR_ICHITARO_ALREADY_RUNNING`）。マクロは最後に一太郎を終了させる命令で終わり、ツールはすべての一太郎のプロセスが終わるのを待つため、開いている一太郎があると結果が不明になるからです（起動中かどうかは Windows の `tasklist` で確かめます）。作者の機械での観測（2026-11-01）では、`/M/` は別の一太郎のプロセスを起動してマクロを実行し、開いていた一太郎と文書はそのまま残りましたが、ツールは 60 秒待ったあと `ERR_ICHITARO_STILL_RUNNING` で止まり、ロックを残しました。一太郎を閉じてから実行してください。`--allow-running-ichitaro`（または環境変数 `ICHITARO_ALLOW_RUNNING=1`）は、この結果不明を承知のうえで送る旗で、開いていた文書が閉じられないことを保証するものではありません。
- 各マクロ実行のタイムアウトは既定で 120 秒です。結果不明のままタイムアウトした場合、自動では再試行せず、一太郎の状態を確認する必要があります。不確かな実行ではロックファイルを残します。マクロ実行を同時に複数走らせないでください。
- マクロ文字列が扱える本文は BMP Unicode の範囲です。要求に改行がない場合だけ読み戻しの改行を除外して比較し、比較方法を証跡に残します。詳細は[マクロアダプタの説明](docs/macro-adapter.md)にあります。
- 実行は一太郎の文書化された `/M/` 起動と Sprint マクロ API を使います。JTD は一太郎自身に作成・保存させます。DLL 解析や DLL コピー、JTD のバイナリ改変は行いません。手元の一太郎のヘルプとマニュアルを調べていますが、その本文・図版・ファイルは再配布しません。

## 内部形式と観測

Catalog は内部形式の Execution Recipe にコンパイルされて実行されます。Recipe を直接実行する `ichitaro-macro`、値の一覧から Recipe を作る `ichitaro-coverage`、JTD のバイト差分を観測する `ichitaro-observe`、マクロ台帳の `ichitaro-catalog` は開発用で、互換性は保証しません。Catalog に出していない内部だけの引数（本文罫線や罫線表の構造操作、段落飾り、文書の組版設定など。[公開対応表](docs/generated/parameter-exposure.md)の internal-only）も Recipe で扱います。[開発者ガイド](docs/developer-guide.md)の「内部形式」と資料一覧を参照してください。

## 開発確認

```powershell
npm test
npm run check
```

自動テスト、構文、Sample Catalog の例、能力一覧の鮮度、ソースツリー内へのドキュメントリンクを確認します。一太郎は起動せず、過去の `runs/` などの実験ストレージがない clone でも完結します。能力一覧を更新するときは `npm run generate:capabilities` を実行します。macOS では、テストが一時ディレクトリにシンボリックリンクを許さないため、`TMPDIR` を実体のパス（`/private/var/...`）にして実行します。

実機証跡は別ゲートで検査します。ドキュメントが参照する run・台帳・観測結果の存在と、参照されている全 run のハッシュ・完了状態を再検証します。実験ストレージがない場合は省略せずに失敗します。

```powershell
npm run check:evidence
node scripts/check-evidence.mjs --storage D:/ichitaro-experiments
```

## ライセンス

[Apache License 2.0](LICENSE)。このライセンスはこのリポジトリのコードと文書に及び、一太郎本体・ヘルプ・マニュアルには及びません。このツールで作った試料のライセンスは、試料を出す先（たとえば OpenJTD 組織の corpus）の取り決めに従います。
