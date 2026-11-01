# openjtd-specimens

一太郎で JTD 試料（テスト用文書）を作成する非公式ツールです。[OpenJTD](https://github.com/OpenJTD) の検証用に、「どのような文書が必要か」を定義した Sample Catalog から、条件を揃えた JTD ファイルと PDF を一太郎自身に生成させます。さらに、保存前と再読み込み後の設定値・本文を読み戻し（リードバック）、要求どおりに作成されたかを照合して記録します。

画面のクリックやキー送信といった GUI 操作は一切行わず、一太郎の公式仕様にある `/M/` 起動オプションと Sprint マクロ機能だけで文書を作成します（マクロの外で行うのは、一太郎が起動中かどうかの確認、実行ファイルの版情報の取得、`ichitaro-pdf` でタイムアウトが発生したときにウィンドウの表示テキストを読み取ることです）。

> 本ツールは個人が開発した非公式ツールであり、株式会社ジャストシステムとは一切関係ありません。同社による承認・保証・サポートはありません。「一太郎」は株式会社ジャストシステムの登録商標です。
>
> 本ツールには一太郎本体・マニュアル・ヘルプは含まれていません。利用には正規にライセンスされた一太郎が必要です。一太郎の使用許諾契約に従って利用してください。
>
> 本ツールは一太郎を自動起動・終了して試料文書を作成します。実行中は一太郎で他の作業を行わないでください。

## OpenJTD との関係

* 本ツールは OpenJTD 組織の公式プロジェクトではなく、個人開発のツールです。OpenJTD 側の `rjtd`・`spec`・`corpus` とは独立して保守されています。

* 本ツールで作成した試料には、元になった Sample Catalog（または PDF Catalog）が出力の一部として残ります（`request.json` と、そのハッシュと版を記録した `compilation.json`）。この記録は corpus 側の要件ではありません。Sample Catalog は試料を作成したときの設定そのものなので、これがあれば同じ条件の試料を一太郎で作り直すことができ、spec が `reproduced` の根拠に求めるもののうち、作成手順と道具・版と再現手段を提供します（変えた変数と結果は、試料の組と観測の側で示します）。PDF Catalog は、どの JTD ファイルから PDF を出力したかの記録です（入力用の JTD は Catalog 作成者が用意します）。

* このリポジトリの Issue では、対応機能の追加提案と不具合報告を受け付けています。現在対応している機能は [capabilities.json](capabilities.json) を、Sample Catalog の書き方は[仕様書](docs/sample-request-spec.md)・[JSON Schema](schemas/sample-catalog.schema.json)・[サンプル集](examples/agent)を参照してください。能力の追加の提案は、[Issue テンプレート](.github/ISSUE_TEMPLATE/capability-request.yml)の節（背景、欲しい最終状態、受け入れ条件、例の Catalog、質問）に沿って書いてください。不具合の報告にも[テンプレート](.github/ISSUE_TEMPLATE/bug-report.yml)があります。

## 読者別の入口

| 対象読者 | 最初に読むドキュメント |
| ----- | ----- |
| 試料を要求する人・AI | [Sample Catalog 仕様](docs/sample-request-spec.md)、[JSON Schema](schemas/sample-catalog.schema.json)、[機械可読の対応機能一覧](capabilities.json)、[完成例](examples/agent)。既存の JTD を PDF 化する場合は [PDF Catalog](schemas/pdf-catalog.schema.json)（使い方は[実行ガイド](docs/execution-agent-guide.md)を参照） |
| Windows で試料を作る人・AI | この README の「必要な環境」「試料を作る」、および[実行ガイド](docs/execution-agent-guide.md) |
| 本ツールの開発者 | [開発者ガイド](docs/developer-guide.md)（Source of Truth、検査手順、内部形式、資料一覧） |

Catalog の検証（`validate`）とコンパイル（`compile`）は macOS や Linux でも実行できます。一太郎が必要になるのは、実際に文書を生成するときだけです。
```sh
mkdir -p tmp
node bin/ichitaro.mjs validate examples/agent/01-minimal.json
node bin/ichitaro.mjs compile examples/agent/01-minimal.json tmp/01-minimal
```

## 必要な環境

* **OS・ランタイム**: Windows、および Node.js 22 以上。外部の npm パッケージには依存していないため、`npm install` は不要です。

* **一太郎**: ライセンス認証済みの一太郎（TARO36）。既定では `C:/Program Files (x86)/JustSystems/TARO36/taro36.exe` を参照します。別の場所にインストールしている場合は、実行コマンドに `--exe <taro36.exe>` オプションを付けるか、環境変数 `ICHITARO_EXE` でパスを指定してください（実行ファイルが見つからない場合は起動前に停止します）。

* **実行権限**: 通常のデスクトップ権限。一太郎のプロセスを起動するため、サンドボックス環境などから実行すると子プロセスが強制終了される場合があります。

動作検証済みの一太郎のバージョンは一太郎 2026 通常盤 のみです。1 台の Windows PC 上で CLI ツールとして使用することを想定しています。

## 試料を作る

プロジェクトのルートディレクトリで実行します。以下の手順で、Catalog の検証・コンパイルから、全試料の順次生成・PDF 出力、受け渡し用フォルダへのパッケージ化までを行います。
```powershell
mkdir tmp, output
node bin/ichitaro.mjs validate examples/agent/01-minimal.json
node bin/ichitaro-request.mjs examples/agent/01-minimal.json tmp/01-minimal runs --pdf
node bin/ichitaro-package.mjs tmp/01-minimal output/01-minimal
```

`examples/agent/` の Sample Catalog はどれでも手順は同じです（`01-minimal.json` は本文だけの試料 1 件、ほかはフォント・ルビ・罫線表などの例。`33-pdf-from-jtd.json` だけは PDF Catalog で、後述の `ichitaro-pdf` で処理します）。`tmp/01-minimal` と `output/01-minimal` には、**まだ存在しない新しいディレクトリ**を指定します（名前は Catalog に合わせて付け替えます。既に存在する場合はエラーになります）。親ディレクトリの `tmp/` と `output/` はあらかじめ作成しておいてください（いずれも Git の追跡対象外です）。

* **`validate`**: JSON Schema・対応機能・意味的制約を検査します。一太郎は起動しません。

* **`ichitaro-request`**: Catalog を内部形式の Recipe にコンパイルし（出力先は新規ディレクトリ）、試料ごとに一太郎を起動して「基準文書（baseline）」と「要求文書」の 2 つの JTD（対照用の `control` を指定した試料では 3 つ）を作成します。さらに読み戻し結果を照合し、`--pdf` 指定時は JTD から PDF も出力します。全体の集計結果は `tmp/01-minimal/execution-results.json` に、各実行（run）の詳細データは `runs/<run-id>/` に保存されます。読み戻し結果が一致しなかった試料は記録を残して次の試料へ進みますが、結果が確定しないタイムアウトやマクロエラーが発生した場合はその時点で停止します。全試料が `verified`（検証済み）にならなかった場合や、`--pdf` 指定時に PDF が出力されない試料があった場合、終了コードは `0` 以外になります。

* **`ichitaro-package`**: 生成された run を再検証し、JTD・PDF・各種記録を 1 つのフォルダにまとめてコピーしたうえで `package-manifest.json` を作成します。このフォルダが OpenJTD 側へ受け渡すパッケージ単位になります。

本ツール以外で作成された既存の JTD ファイルを PDF に変換する場合は、PDF Catalog を用いて `node bin/ichitaro-pdf.mjs <pdf-catalog.json> <input-directory> <new-output-directory>` を実行します（詳細は[実行ガイド](docs/execution-agent-guide.md)を参照）。

各 run の `samples/<sample-id>/` には、一太郎が保存した `document.jtd`、要求値・観測値・検証結果・ハッシュ値を記録した `manifest.json`、およびマクロのソースコードと一太郎からの返却値を収めた `evidence/` が保存されます。また、run 直下の `index.html` にレポートが出力されます。記録の整合性は以下のコマンドで再検査できます。
```powershell
node bin/ichitaro.mjs verify "runs/<run-id>"
node bin/ichitaro.mjs report "runs/<run-id>"
```

`verify` は記録された SHA-256 ハッシュとファイルサイズを実ファイルから再計算し、改変や欠落を検出します（ハッシュによる整合性確認であり、一太郎自体の動作の正しさや記録の真正性を保証するものではありません）。

## 実行時の注意

* **実行前に一太郎を閉じておくこと**: 一太郎がすでに起動している場合、既定ではマクロを送信せずに停止します（`ERR_ICHITARO_ALREADY_RUNNING`）。マクロは最後に一太郎を終了させる命令で終わり、ツール側はすべての一太郎プロセスが終了するのを待機するため（Windows の `tasklist` で確認）、開いている一太郎があると実行結果を判定できなくなるためです。実機での検証（2026-11-01）では、一太郎を開いた状態で `/M/` を実行すると別プロセスでマクロが処理され、元から開いていた一太郎と文書はそのまま残ったものの、ツール側は 60 秒待機したのちに `ERR_ICHITARO_STILL_RUNNING` で停止しロックファイルを残す結果となりました。実行前に必ず一太郎を閉じてください。`--allow-running-ichitaro` オプション（または環境変数 `ICHITARO_ALLOW_RUNNING=1`）は、この結果不明となるリスクを承知のうえでマクロを送信するフラグであり、開いていた文書が閉じられないことを保証するものではありません。

* **タイムアウトと同時実行の禁止**: 各マクロ実行のタイムアウトは既定で 120 秒です。結果不明のままタイムアウトした場合はロックファイルを残して停止し、自動での再試行は行いません。一太郎の状態を手動で確認してください。また、複数のマクロ実行を同時に走らせないでください。

* **文字コードと改行の扱い**: マクロの文字列リテラルで扱える本文は BMP（基本多言語面）の Unicode 文字の範囲です。要求仕様に改行が含まれない場合に限り、読み戻し時の改行を除外して比較し、適用した比較方法を証跡に記録します。詳細は[マクロアダプタの説明](docs/macro-adapter.md)を参照してください。

* **仕様準拠と非改変の方針**: 実行には一太郎の公式仕様として文書化された `/M/` 起動オプションと Sprint マクロ API を使用し、JTD ファイルは一太郎自身に作成・保存させるものです。DLL の解析や複製、JTD のバイナリ改変は行っていません。また、開発にあたり手元の一太郎のヘルプとマニュアルを参照していますが、その本文・図版・ファイルを直接再配布するものではありません。

## 内部形式と観測

Sample Catalog は内部形式の Execution Recipe にコンパイルされてから実行されます。Recipe を直接実行する `ichitaro-macro`、パラメータ値の一覧から Recipe を生成する `ichitaro-coverage`、JTD のバイト差分を観測する `ichitaro-observe`、およびマクロ台帳を扱う `ichitaro-catalog` は開発用コマンドであり、互換性は保証されません。Sample Catalog には公開していない内部専用パラメータ（本文罫線や罫線表の構造操作、段落飾り、文書の組版設定など。[公開対応表](docs/generated/parameter-exposure.md)の `internal-only` 項目）も Recipe で扱います。詳細は[開発者ガイド](docs/developer-guide.md)の「内部形式」と資料一覧を参照してください。

## 開発確認
```powershell
npm test
npm run check
```

`npm test` は自動テストを、`npm run check` は構文チェック、Sample Catalog のサンプル検証、対応機能一覧の鮮度、およびソースツリー内のドキュメントリンクを確認します。一太郎は起動せず、過去の `runs/` などの実験ストレージがないクローン環境でも完結します。対応機能一覧を更新するときは `npm run generate:capabilities` を実行します。なお、macOS ではテストが一時ディレクトリにシンボリックリンクを許可しないため、`TMPDIR` に実体のパス（`/private/var/...`）を指定して実行してください。

実機の証跡（Evidence）は別ゲートで検査します。ドキュメントが参照している `runs/`・台帳・観測結果の存在確認と、参照されている全 run のハッシュおよび完了状態の再検証を行います。実験ストレージが存在しない場合はスキップされずエラーになります。
```powershell
npm run check:evidence
node scripts/check-evidence.mjs --storage D:/ichitaro-experiments
```

## ライセンス

[Apache License 2.0](LICENSE) のもとで公開しています。このライセンスは本リポジトリのコードと文書に適用され、一太郎本体・ヘルプ・マニュアルには及びません。本ツールで作成した試料のライセンスは、試料の提出先（たとえば OpenJTD 組織の `corpus`）の取り決めに従います。
