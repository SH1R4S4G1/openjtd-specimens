# 開発者向け入口と契約の保守

外部要求は [sample-request-spec.md](sample-request-spec.md)、Windows実行者は [execution-agent-guide.md](execution-agent-guide.md)、人間の初回利用は [README](../README.md) が入口です。

## 現状と設計境界

既存Recipeは8数値のdefaults、共通本文、baselineからのvariants、範囲操作や罫線操作の履歴を表す内部実行形式です。`experiment.mjs`をMacroAdapter実行、coverage、observation、CLIが利用しています。これらの入力を変更すると既存試料と観測経路へ影響するため、要求層を追加する方式にしました。

Sample Catalogは試料ごとに独立した本文と最終属性を持ち、テスト意図と期待値を保持します。コンパイラが範囲選択、属性設定、空白キャンバス等を組み立て、各要求を既存schema-v1 Recipeへ落とします。全要求を検証後に書き出すため、未対応要求の一部だけを成功扱いにはしません。baselineを含む2試料/要求です。意味的に同じ非重複annotationsは位置順に正規化します。

要求APIは実装全体の部分集合です。公開能力・パラメータ・制限の最新情報は [自動生成Capability詳細表](generated/sample-capabilities.md) を参照してください。機械一覧の `status` と `requestSupported` を分け、未公開を未実装と取り違えない設計です。期待値比較器は将来実装であり、propertyラベルの命名規約もOpenJTDとの別途合意が必要です。

## Source of Truth

| 対象 | 正とする場所 | 派生物・検査 |
|---|---|---|
| Sample Catalogの構造・型・enum・数値範囲 | [JSON Schema](../schemas/sample-catalog.schema.json) | CLIが同じファイルを読み検証する |
| PDF Catalog（既存JTDのPDF、CR-006）の構造 | [JSON Schema](../schemas/pdf-catalog.schema.json)、意味的制約は [pdf-catalog.mjs](../src/pdf-catalog.mjs) | `validate` が `kind` で振り分ける。公開能力は sample-capabilities.mjs の CATALOG_CAPABILITIES |
| 本文一致・ID参照・組合せと変換 | [sample-catalog.mjs](../src/sample-catalog.mjs) | 既存のexpandExperimentによる追加検査 |
| 内部能力の実装状況・制限 | [macro-catalog.mjs](../src/macro-catalog.mjs) のMACRO_CAPABILITIES | 既存macro catalogと外部一覧が共用 |
| 文書スタイル入力 | [features.mjs](../src/features.mjs)、[experiment.mjs](../src/experiment.mjs) | 既存実行検証、外部一覧 |
| 要求APIの公開バインディング・制限 | [sample-capabilities.mjs](../src/sample-capabilities.mjs) | コンパイラと機械一覧が共用 |
| 外部機械一覧 | [capabilities.json](../capabilities.json)（生成物） | generate:capabilitiesで再生成、手編集不可 |
| Capability詳細Markdown | [docs/generated/sample-capabilities.md](generated/sample-capabilities.md)（生成物） | 同じコード・正式Schemaから生成、手編集不可 |
| 内部パラメータ一覧 | ranges/keisenのvalidator共有フィールド定義、features/experimentの定義 | 新しい内部フィールドを自動検出 |
| パラメータ公開方針 | [parameter-exposure.mjs](../src/parameter-exposure.mjs) のPARAMETER_EXPOSURE | 公開先・固定値方針・未公開理由を明示 |
| 公開対応表 | [parameter-exposure.json](../parameter-exposure.json)、[生成Markdown](generated/parameter-exposure.md) | コードとSchemaから生成、直接編集禁止 |
| Few-shot例 | [examples/agent](../examples/agent) | 全例を検証・コンパイルして実行形式との互換性をテスト |
| Markdown | Schemaと能力一覧の読み方を説明 | リンク存在チェック。状態・件数の手動集計は追加しない |

既存の実行バリデータは後方互換性を維持して残します。外部契約の構造・値域はSchemaに集約し、意味的制約はコンパイラと既存バリデータで検査します。依存追加を避けるため [schema-validation.mjs](../src/schema-validation.mjs) はこのSchemaで使うJSON Schema語彙だけを実装し、未対応キーワードを起動時に拒否します。一般用途のJSON Schemaライブラリではありません。語彙を増やす場合は標準対応の検証器への移行も検討してください。

## 開発確認

```sh
npm run generate:capabilities
npm test
npm run check
```

npmがPATHにない環境では順に `node scripts/generate-capabilities.mjs`、`node --test`、`node scripts/check.mjs` が同じ処理です。checkは構文、Schemaと公開能力の整合、canonical examples、生成一覧の鮮度、README/docs内のソースツリーへの相対Markdownリンクを検査します。テストは不正入力、CLI、メタデータとハッシュ対応、既存マクロコンパイルまでを検査し、一太郎は起動しません。実機での全値域の正しさは保証しません。

## Source repository と Experiment storage の境界

source repository ≠ experiment storage です。`runs/`、`catalogs/`、`observations/`、`tmp/`、`output/` は実験ストレージで、Gitで追跡しません（[.gitignore](../.gitignore)）。ゲートは次の2つに分かれます。

| ゲート | コマンド | 必要なもの | 検査内容 |
|---|---|---|---|
| Portable / offline gate | `npm test`、`npm run check` | ソースツリーのみ | テスト、構文、契約、生成物の鮮度、ソースへのリンク。実験ストレージへのリンクは分類と構造（リポジトリ外へ出ないこと）だけを検査する |
| Evidence integrity gate | `npm run check:evidence`（`node scripts/check-evidence.mjs [--storage <dir>]`） | 実験ストレージ | README/docsが参照する証跡リンクの存在、本文中のrun IDを含む全runの `verifyRun`（ハッシュ・サイズ・計画試料の完了） |

境界の分類と両ゲートの実装は [evidence-references.mjs](../src/evidence-references.mjs) にあります。テストはOSの一時ディレクトリだけを使い、`tmp/` 等の有無や実行順に依存しません。生成物はバイト単位で比較するため、[.gitattributes](../.gitattributes) で全チェックアウトをLFに固定しています。

Evidence gateの実験ストレージは既定でリポジトリ直下です。別の場所に置く場合は `--storage` か環境変数 `ICHITARO_EXPERIMENT_STORAGE` で指定します。`--storage` は繰り返せます（環境変数ではパスの区切り文字、Windows では `;` で並べる）。最初のものが実験ストレージで、そこにないリンクとrunは、続くストレージから順に探します。別の作業ツリーが作ったrunは、そのツリーを続くストレージとして渡して確かめます（例: `node scripts/check-evidence.mjs --storage . --storage ../<別の作業ツリー>`）。続くストレージで見つかったrunは、結果の `runsInAdditionalStorages` に出ます。ストレージが見つからない場合は省略せず `STORAGE_NOT_FOUND` で失敗します。実機runを文書で引用したら、コミット前にこのゲートを実行してください。

runの判定は3層に分かれます。

| 層 | 担当 | 内容 |
|---|---|---|
| integrity | `verifyRun`（観測） | 記録された成果物がハッシュ・サイズと一致し、索引・manifestが正しい。エラーは `category: "integrity"` |
| completion | `verifyRun`（観測） | 計画した全試料が完了した。未完了は `category: "completion"`（`MISSING_PLANNED_SAMPLE`、`INCOMPLETE_SAMPLE`）。索引が読めない場合は `complete: null`（不明） |
| acceptance | evidence gate（方針） | 文書がそのrunを証跡として引用してよいか |

`verifyRun` は低レベルの検証器で、事実だけを返します。未完了のrunは常に `ok: false` で、許容の判断はしません。

停止・中断したrunを履歴として引用する場合は、[evidence-expectations.json](../evidence-expectations.json) の `incompleteRuns` にrun IDと理由を記録します。gateが `accepted-known-incomplete` とするのは、integrityが正常で、completionが未完了で、かつ宣言があるrunだけです。integrityの失敗は宣言があっても `rejected` です。未宣言の未完了runは `UNDECLARED_INCOMPLETE_RUN`、全試料が完了したrunの宣言は `STALE_INCOMPLETE_DECLARATION` として失敗します。出力にはrunごとの3層の判定と、受け入れた既知の未完了runの理由を記録します。宣言されたrunが文書で引用されていることは、portable gateでも検査します。

catalogs・observationsは参照先の存在だけを検査します。内容の正しさは、それぞれを生成した元runの検証に依存します。

正式な生成コマンドは `node scripts/generate-capabilities.mjs`（`npm run generate:capabilities`も同じ処理）です。capabilities.json、docs/generated/sample-capabilities.md、parameter-exposure.json、docs/generated/parameter-exposure.mdを更新します。checkは期待内容とファイルをバイト単位で比較し、欠落・古い内容・手編集を失敗にします。生成日時を含めず、同じ入力から同じ内容を出します。check自体は生成物を書き換えません。コミット前/CIの必須ゲートとして実行してください。Gitフックを使わずに手動でチェックを省略したコミットまで禁止する機能ではありません。

## 新Capability追加の標準手順

1. 一太郎側の実装を追加します。対象に応じてadapters/macro、ranges、keisen、features等と内部Recipeの入力検証を変更します。
2. 正規一太郎で生成し、保存前・保存後・再読込後に期待属性が維持されることを確認してrun証跡を残します。getterで確認できない値は未検証と明示します。
3. 内部Capabilityをmacro-catalog.mjsのMACRO_CAPABILITIES等へ登録します。実装済みと実機証跡の段階を区別します。
4. 外部に公開可能か判断します。最終状態として表現でき、制約・検証限界が説明できる安定した能力だけを公開します。内部実装済みでも不安定なら未公開にします。
5. 公開する場合はsample-capabilities.mjsのREQUEST_BINDINGSへ登録します。この登録と内部implementedの組合せがrequestSupportedを決めます。内部だけの能力は登録せず、生成一覧でfalseになることを確認します。

   同時にPARAMETER_EXPOSUREで各内部パラメータをpublic / fixed / internal-onlyに分類します。publicは外部Schemaの定義とfield、fixedはコンパイラで固定・導出する方針、internal-onlyは未公開理由を指定します。内部だけの能力でもパラメータの分類は省略しません。
6. 正式JSON Schemaへfeature ID、要求構造、型、必須性、enum、値域を追加します。バインディングのdefinitionはdocumentから参照可能な$defsを指します。数値範囲やパラメータ一覧をMarkdownへ写しません。
7. 本文一致・参照・組合せなどSchemaだけでは表現できない意味的制約をsample-catalog.mjsと必要な既存validatorへ追加します。
8. sample-catalog.mjsのcompilerに既存Execution Recipeへの変換を実装します。要求コピー、メタデータ対応、独立baselineの扱いを維持します。
9. examples/agentへcanonical exampleを追加し、必要に応じて正常・境界・不正入力のテストも追加します。例をvalidateし、既存Recipe/マクロへの変換まで確認します。
10. 正式生成コマンドでJSONと詳細Markdownを再生成します。新しいSchema構造/語彙を使った場合だけ、生成器とSchema評価器の対応も確認・拡張します。
11. `node --test` と `node scripts/check.mjs` を実行し、両方成功させます。手順2の実機runを文書へ引用したら、実験ストレージのある環境で `node scripts/check-evidence.mjs` も成功させます。
12. 新しい概念や誤解しやすい意味が増えた場合だけsample-request-spec等の説明文を更新します。完全な能力表は生成物に任せます。

外部非公開の場合は5～9の要求API変更は不要ですが、内部実装・実機検証・公開しない判断・生成一覧・全テスト/checkは必要です。破壊的な要求構造変更は新しいschemaVersionとして設計し、既存Recipeのバージョンとは独立に移行します。

## Definition of Done

- [ ] 正規一太郎で試料を生成でき、保存後も要求属性を保持する。
- [ ] 再読込後に検証できる属性と検証できない項目を区別し、run証跡を残した。
- [ ] 内部Capability定義へ登録し、実装状況と実機検証段階が正しい。
- [ ] 外部公開可否を判断し、生成一覧のrequestSupportedに反映されている。不安定な能力は未公開のままである。
- [ ] 全内部パラメータに公開/固定/未公開の判断があり、公開先または未公開理由が対応表へ出力される。
- [ ] 公開する場合、正式Schemaの構造・型・enum・値域・feature IDと公開バインディングが揃っている。
- [ ] 公開する場合、必要な意味的validationがあり、compilerが既存Execution Recipeへ変換できる。
- [ ] 公開する場合、canonical exampleが存在しvalidateとRecipe/マクロコンパイルを通る。
- [ ] capabilities.jsonと自動生成Capability Markdownを再生成した。
- [ ] parameter-exposure.jsonとパラメータ公開対応Markdownも再生成した。
- [ ] `node --test` が成功した。
- [ ] `node scripts/check.mjs` が成功し、生成物の鮮度・Schema対応・例・リンクが確認できた。
- [ ] 実験ストレージを保持した環境で `npm run check:evidence` が成功し、文書で引用したrun・台帳・観測の存在とrunの整合性が確認できた。停止runを引用した場合は理由を `evidence-expectations.json` に記録した。
- [ ] sample-request-spec等へ人手の概念説明を追加すべきか確認し、必要な場合だけ更新した。

テストの成功は実機証跡の代わりにはなりません。未実施の実機検証を完了扱いにしないでください。

## 手動編集と自動生成の境界

通常の能力追加で手動編集するのは、該当する内部実装/validator、macro-catalog.mjs等の内部定義、公開時のみsample-capabilities.mjs・sample-catalog.schema.json・sample-catalog.mjs・examples/agent・関連テストです。新しい概念の説明が必要な場合のみ利用文書を編集します。生成器に個別Capability名・document kind・値域を足してはいけません。

capabilities.json、parameter-exposure.jsonとdocs/generated配下の生成Markdownは直接編集禁止です。履歴文書の当時の結果は履歴として保持し、現行一覧の代用にはしません。自動検査はSchema/public bindingの双方向対応、参照する定義の存在とdocumentからの到達、公開能力のimplemented状態、全公開能力の例による網羅、例のvalidation、生成物差分、生成文書を含む相対リンクを検出します。

パラメータ監査は、validator共有フィールド一覧と公開方針の差分、新たな未分類フィールド、削除済みフィールドの古い方針、存在しない外部Schemaフィールド、内部対応のない公開パラメータを拒否します。公開判断そのものは自動推測しません。内部に引数を追加したら共有フィールド定義とvalidatorを更新し、対応表の方針をレビューしてください。新しい内部Capabilityのパラメータ供給元はinternalParameterInventoryへ登録します。監査対象はこのアプリのRecipe引数であり、一太郎の全マクロ引数や取得専用属性ではありません。target/type/attributeなどの共通操作識別子はコンパイラが構成する構造情報です。

## 内部形式（Recipe）と開発用コマンド

Sample Catalog は外部向けの契約で、`compile` が内部形式の Execution Recipe（schema v1、8数値の defaults・共通本文・variants・操作履歴）に変換します。Recipe を直接実行する `ichitaro-macro`、値の一覧から Recipe を作る `ichitaro-coverage`、JTD のバイト差分を観測する `ichitaro-observe`、マクロ台帳の `ichitaro-catalog` と、`examples/*.json` の Recipe は開発用です。内部形式であり、互換性は保証しません（Catalog に出していない引数を試すために残しています。公開・固定・内部専用の区分は[公開対応表](generated/parameter-exposure.md)）。

## 内部実装・履歴資料

- [MacroAdapter・停止時の扱い](macro-adapter.md)
- [範囲Recipe・macro catalogのv0.5設計記録](range-recipes.md)
- [文書スタイルと組合せ生成](coverage.md)
- [密着・均等](allocation-recipes.md)、[ルビ](ruby-recipes.md)、[文字装飾](decoration-recipes.md)
- [罫線・セル属性・行高列幅・分割結合](keisen-recipes.md)
- [禁則・ジャスティフィケーションの設定](typesetting.md)
- [OpenJTDからの依頼（APP-01〜19）の対応状況](maintainer/openjtd-requests-20261014.md)
- [段落書式・タブ・段落飾りの検証境界](maintainer/paragraph-development.md)
- [文書構造・単純段組](maintainer/document-structure-development.md)
- [エージェントの実行経路と既存Recipe](agent-usage.md)
- [JTD差分観測](observation.md)

画面操作で試料を作っていた旧経路（Computer Use の `sky` を受け取る Workbench、UI Automation の読み取り、`scripts/build-bridge.mjs`、GUI アダプタ）は、`bin/` のどのコマンドからも使われておらず、0.21.0 で削除した。経緯と当時のコードは git の履歴（0.20.2 以前）にある。スクリーンショットを証跡として保存する経路（`saveEvidence`）と manifest の `verification.hasScreenshot` は 0.22.0 で削除し、証跡としてはマクロの読み戻し（保存前と再読込後）だけを認める（`verified` にはほかに、検証の合格、題名の一致、観測値が要る）。`verify` は証跡ファイルを種類によらずハッシュで照合するので、過去の run に残るスクリーンショットと `hasScreenshot` 欄はそのまま検査できる。`src/ichitaro-build.mjs` の UI Automation は PDF 経路で窓の文言を読むためのもので、旧経路とは別物である。

`catalogs/*` と `runs/*` はローカルの実機証跡（実験ストレージ）で、通常のcloneには含まれません。証跡へのリンクは上記のEvidence gateで検査します。歴史的な件数・速度・能力段階は当該版の記録であり、最新状態は生成された一覧または新規作成したmacro catalogのsummaryを参照します。罫線表はv0.9の旧属性証跡とv0.10以降の検証を区別してください。

- [単独脚注の試料と検証境界](footnotes.md)
- [枠（レイアウトボックス）](frames.md)
- [機能の組合せ](combinations.md)

## 開発記録（`docs/maintainer/`）

[docs/maintainer/](maintainer/README.md) には、開発中の実機検証の記録と、OpenJTD 側の依頼への対応状況があります。公開版の利用には不要です。
