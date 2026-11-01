# Sample Catalog導入・ドキュメント整理の完了報告

2026-10-11 JST

## 1. 調査して分かった現状

アプリケーションはv0.12.0。現行の主経路はMacroAdapter CLIで、正規一太郎を起動し、作成・保存・再読込検証まで自動実行します。既存Recipeは文書スタイルと操作履歴を持つ内部実行形式で、CLI、Workbench、coverage、observation、macro-runから参照されています。

文字範囲、密着・均等、ルビ、装飾、本文罫線、罫線表、行高・列幅、限定的な分割・結合が実装されています。一方、旧文書にはGUI経路との混在、表未実装という記述、v0.5の件数・将来計画が残っていました。段落属性や脚注等は現在も未実装です。能力の一覧は固定件数を本文へ転記せず [capabilities.json](../../capabilities.json) を参照します。

## 2. 採用したSample Catalogの設計

意味ベースの最終状態を宣言するschema-v1 JSONを追加しました。各試料はid、title、purpose、feature、expected、documentを必須とし、testIntent、tags、prerequisites、relatedSamplesを任意で保持します。未知フィールドは拒否します。

本文、文書フォント、文字横幅・サイズ・数値字間・密着・均等・ルビ、空の罫線表を公開します。能力の実装状況と要求APIへの公開状況を分離し、実装済みの高度な操作を未実装扱いにはしません。

## 3. Execution Recipeとの境界

要求側は操作・マクロ名を書きません。コンパイラが1要求を1既存Recipeへ変換し、baselineと要求試料を生成する計画にします。元要求のメタデータはrequest.json、Recipeとの対応とSHA-256はcompilation.jsonへ保持します。既存の厳密なRecipe構造へメタデータを追加しない設計です。

複数本文を持つ要求は独立Recipe群にします。Windows実行AIは順次実行し、sampleIdとrunDirの対応を記録します。解除・再設定等の履歴は既存Recipeの責務として残します。

## 4. Source of Truth

- 構造・型・enum・値域: [正式JSON Schema](../../schemas/sample-catalog.schema.json)
- ID参照、本文一致、重複範囲等の意味的検査と変換: [コンパイラ](../../src/sample-catalog.mjs)
- 内部実装状況: 既存 [macro catalogの定義](../../src/macro-catalog.mjs) と文書スタイル定義
- 要求APIの公開範囲: [公開バインディング](../../src/sample-capabilities.mjs)
- capabilities.json: 上記コードとpackage.jsonから生成する派生物

詳細な保守手順は [開発者ガイド](../developer-guide.md) にまとめました。

## 5. 新規ファイル

| 分類 | ファイル |
|---|---|
| 正式契約 | [schemas/sample-catalog.schema.json](../../schemas/sample-catalog.schema.json)、[capabilities.json](../../capabilities.json) |
| 利用文書 | [sample-request-spec.md](../sample-request-spec.md)、[execution-agent-guide.md](../execution-agent-guide.md)、[developer-guide.md](../developer-guide.md)、本報告 |
| 実装 | [src/sample-catalog.mjs](../../src/sample-catalog.mjs)、[src/sample-capabilities.mjs](../../src/sample-capabilities.mjs)、[src/sample-schema.mjs](../../src/sample-schema.mjs)、[src/schema-validation.mjs](../../src/schema-validation.mjs) |
| 生成・整合チェック | [scripts/generate-capabilities.mjs](../../scripts/generate-capabilities.mjs)、[scripts/check-contract.mjs](../../scripts/check-contract.mjs) |
| テスト | [test/sample-catalog.test.mjs](../../test/sample-catalog.test.mjs) |
| Few-shot例 | [01-minimal.json](../../examples/agent/01-minimal.json)、[02-font-variations.json](../../examples/agent/02-font-variations.json)、[03-ruby.json](../../examples/agent/03-ruby.json)、[04-character-spacing.json](../../examples/agent/04-character-spacing.json)、[05-keisen-table.json](../../examples/agent/05-keisen-table.json)、[06-combination.json](../../examples/agent/06-combination.json)、[07-range-attributes.json](../../examples/agent/07-range-attributes.json) |

## 6. 変更した既存ファイル

| ファイル | 変更内容 |
|---|---|
| [README.md](../../README.md) | 4読者の入口、検証・コンパイルの基本操作 |
| [bin/ichitaro.mjs](../../bin/ichitaro.mjs) | validate / compileを追加、既存コマンドを保持 |
| [src/macro-catalog.mjs](../../src/macro-catalog.mjs) | 既存能力定義をexportし共有 |
| [package.json](../../package.json) | generate:capabilitiesスクリプトを追加 |
| [scripts/check.mjs](../../scripts/check.mjs) | 要求契約・例・能力鮮度・文書リンクの検査を追加 |
| [agent-usage.md](../agent-usage.md) | 現行Macro経路と旧GUI/Computer Use資料を分離 |
| [macro-adapter.md](../macro-adapter.md) | 現行対応範囲と限定的な罫線表操作を明記 |
| [range-recipes.md](../range-recipes.md) | 統計・ロードマップをv0.5の歴史資料として明示 |
| [coverage.md](../coverage.md) | 表未対応という旧記述を現行の限定実装と区別 |
| [ruby-recipes.md](../ruby-recipes.md) | 後続版で完了したロードマップを歴史として整理 |
| [decoration-recipes.md](../decoration-recipes.md) | v0.8当時と後続の罫線対応を区別 |

## 7. 後方互換性への影響

既存Recipe、既存examples、MacroAdapter、verify/report、macro catalogの入力・出力形式を維持しています。新しいvalidateはSample Catalog専用、既存planは引き続きExecution Recipe専用です。外部依存パッケージは追加していません。GUIブリッジを含む既存129テストは維持されています。

## 8. Validation方法

```sh
node bin/ichitaro.mjs validate examples/agent/03-ruby.json
node bin/ichitaro.mjs compile examples/agent/03-ruby.json tmp/new-request
```

compileの出力先は未作成で、親ディレクトリは必要です。JSON解析、Schema、能力の実装・公開状態、パラメータ、本文範囲、参照、組合せ、既存Recipeの計画検証を行います。成功は終了0とok:true、失敗は終了1とエラーJSONです。一太郎は起動しません。

## 9. 実行したテストと結果

- 既存テスト: 129件成功。
- 追加後の全テスト `node --test`: 142件成功、失敗・skipとも0。
- 新規13テスト: 正常例のRecipe/マクロコンパイル、未知フィールド・能力・異常値・非BMP文字の拒否、意味的制約、CLI、BOM、メタデータ保持、ハッシュ、上書き防止等を確認。
- `node scripts/check.mjs`: 構文、Schemaと公開能力の整合、7つのcanonical examples、正式仕様内の完成例、capabilities.jsonの鮮度、README/docsの相対リンクを確認。
- `node scripts/generate-capabilities.mjs`: 能力一覧を生成。

環境のPATHにnpmがなかったため、npm test / npm run checkが指定するNodeコマンドを直接実行しました。今回の追加要求について、一太郎実機の新規JTD生成とOpenJTD解析は実行していません。

## 10. 残る課題

OpenJTDの解析結果へexpectedを結び付ける属性名規約と自動PASS/FAIL比較器は未実装です。prerequisitesも実行AIによる環境確認が必要です。複数Recipeの実行結果を集約する自動runnerは追加していません。

要求APIは短い横書き本文・非重複範囲・空の小さな罫線表に限定しています。高度な表操作や履歴の意味ベース要求への拡張は今後の対象です。均等幅の実測検証、一般的な表編集、段落属性等の既存制約は残ります。

Schema評価器はこの契約で使用する語彙に限定し、未対応キーワードを拒否します。将来Schema語彙を増やす場合には標準検証ライブラリの導入も検討します。validate成功と実機生成成功・OpenJTD解析成功は区別します。
