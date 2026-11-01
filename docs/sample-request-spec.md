# OpenJTD用 Sample Catalog v1

この仕様は、OpenJTDの解析器を改善・回帰検証するために、正規の一太郎で生成するJTD試料を要求する契約です。OpenJTD側AIは**必要な文書の最終状態とテスト意図**をJSONにします。一太郎の操作手順、マクロ、内部API、実行順序は書きません。Windows側が検証・変換・生成を担当します。

## 渡すもの

UTF-8 JSON（BOM可）のSample Catalogを1ファイルで渡します。JSON Schemaは [sample-catalog.schema.json](../schemas/sample-catalog.schema.json)、能力一覧は [capabilities.json](../capabilities.json)、正しい完成例は [examples/agent](../examples/agent) です。この3点と本書を同じリリースから取得してください。外部パッケージや一太郎をインストールせず、Node.js 22以上で検証できます。

能力ごとの一覧・document kind・指定場所・パラメータの型/必須性/enum/値域/制限は [自動生成Capability詳細表](generated/sample-capabilities.md) を参照してください。本書は共通概念と書き方を説明し、能力追加のたびに完全な一覧を追記しません。

`capabilities.json` の `status: "implemented"` **かつ** `requestSupported: true` の能力だけを要求できます。実装済みでもSample Catalogに公開していない能力があります。各 `parametersSchema` は正式Schema内の対応する定義を指し、`limitations` は検証の限界を説明します。実装済みは、全値域を実機検証済みという意味ではありません。

## Catalogと試料のフィールド

すべてのオブジェクトは未知フィールドを拒否します。必須以外は省略可能ですが、`null`での代用はできません（`expected[].value`だけはnull可）。

| 場所・フィールド | 必須 | 型・意味 |
|---|---|---|
| root.schemaVersion | ○ | 整数 `1`。要求契約のバージョン |
| root.id | ○ | Catalogの識別子 |
| root.samples | ○ | 試料要求の配列、1～100件 |
| sample.id | ○ | Catalog内で一意の試料識別子 |
| sample.title | ○ | 人間向けの名前、1～200文字 |
| sample.purpose | ○ | OpenJTDで何を確かめるか、1～2000文字 |
| sample.feature | ○ | 検証の中心となる能力IDを1つ。documentに実際に含まれている必要がある |
| sample.document | ○ | 下記の本文または罫線表 |
| sample.expected | ○ | `{ "property": "意味のある属性名", "value": 値 }` の配列、1～32件 |
| sample.testIntent | — | `parse` / `regression` / `boundary` / `comparison` |
| sample.tags | — | 重複しない文字列配列、0～20件、各1～80文字 |
| sample.prerequisites | — | フォント・対象環境等の前提条件を表す文字列配列、0～20件、各1～300文字 |
| sample.relatedSamples | — | 同じCatalog内の別試料IDの配列、重複・自己参照不可、0～20件 |

識別子は小文字英字で始まる1～60文字の小文字英数字・ハイフンです。`baseline`、Windowsの予約デバイス名（`con`、`nul`、`com1`等）は使用できません。

`expected[].property` は1～200文字の属性名、`value` は文字列・有限数値・真偽値・nullです。例の `range[2:4].ruby.reading` は比較対象を示すラベルで、実行可能な式や標準化済みのOpenJTDパス構文ではありません。現在は値をそのまま保持し、解析後の比較器へ引き渡します。期待値と文書の整合は作成者が確認してください。検証コマンドは期待値の正しさ、前提条件の充足、OpenJTDのPASS/FAILを判定しません。

## 文書の指定

本文の基本形は `{ "kind": "text", "text": "甲乙対象丙丁" }` です。本文は最大60000字で、LF で区切った空でない段落を含められます。範囲注釈の start / end はLFを1文字として数える位置で、範囲は1つの段落の中に置きます。2000字を超える本文（CR-003、[例](../examples/agent/32-long-text.json)）は横書きだけで、段落は1000個までです。範囲注釈を置けますが、1文字ずつ読み戻すのは注釈を置いた段落だけで（合わせて2000字まで）、ほかの段落の文字の属性は読みません。本文全体は1文字ずつではなく、読み戻した行をつないだ文字列、各段落の終わりが行の区切りに一致すること、段落の先頭・末尾の文字と段落の数で確かめます。フォント等を指定する場合は詳細表の指定場所とSchemaに従います。フォント名を推測せず、Windows側で利用できることを前提条件に記します。未指定属性は環境に依存します。

範囲属性は任意の `annotations` 配列に記述します。各要素は `capability`、`range`、`parameters` が必須です。`range` は `{ "start": 2, "end": 4, "text": "対象" }`。位置は0始まりのUTF-16単位、endは対象を含まない位置で、textは本文の該当部分と完全一致させます。現在の範囲本文はBMP限定のため通常の文字数と一致します。能力IDとparametersを推測せず、詳細表の同じ分岐から選びます。

意味上の注意として、密着割付と数値字間は別機能です。均等割付の有無を確認できても、幅の正しさまで検証できるとは限りません。ルビの読みは明示し、自動推測しません。各能力の省略時の扱いと検証の限界は詳細表のlimitationsを確認してください。

ルビの文字揃え（alignment）と上下配置（placement）は別の属性です。均等配置では左右位置の指定は適用対象外になります。[文字揃えの完成例](../examples/agent/08-ruby-alignment.json)を参照してください。

範囲の重なりは属性が異なっても拒否します。隣接範囲、別々の範囲属性、文書フォントと範囲属性の併用は可能です。annotationsの配列順序に操作順の意味はありません。要求は文書の最終状態を表し、解除・変更の操作履歴は内部Execution Recipeの責務です。未公開の能力を内部実装から推測して要求しないでください。

文書種別ごとに構造が異なります。たとえば空の罫線表の要求を、一般的な表編集や本文と自由に併用できる契約と解釈してはいけません。詳細表のdocument kindとSchemaの分岐を確認してください。

罫線表の `cells` は、行・列を1始まりで指定したセルの最終属性集合です。同じセルの重複指定は拒否し、セルと属性の並び順はコンパイラが正規化します。指定しなかったセル属性は環境から継承し、設定操作による対象外セルへの漏れも読み戻しで検査します。`fill: 0` 等は最終状態の指定であり、設定後に解除する履歴を意味しません。[セル属性の完成例](../examples/agent/09-table-cell-attributes.json)と生成詳細表を参照してください。

表は最大4×4です。`rowHeights`（通常行単位2〜4、合計9以下）と `columnWidths`（半角単位の偶数4〜10、合計18以下）は行・列ごとの最終寸法、`merges` は重ならない結合矩形（最大4、`from` が左上・`to` が右下）です。セルの `text` は結合後のセル幅から決まる min(4, 幅/2−1) 字以内の、空白を含まない1行の文字です。結合セルは左上の位置で指定し、内側の位置を指定すると拒否します。2×2以下で既定寸法・結合なしの表は従来の経路で処理し、線種・線色を省略できます。それ以外（3行・3列以上、寸法指定、結合）は線種・線色の明示が必要です。結合・文字・属性の合計は、3行・3列以上または結合を含む表で15、それ以外で7までです。読み戻しでは観測グリッド全点の8方向の罫線、全セルの属性、セルごとの物理行の文字を保存前と再読込後に照合します。分割・行列の追加削除の履歴は内部Recipeの責務です。[表の構造の完成例](../examples/agent/29-table-structure.json)を参照してください。

## 正しい完成例

最小の本文試料:

```json
{
  "schemaVersion": 1,
  "id": "text-catalog",
  "samples": [{
    "id": "text-only",
    "title": "本文のみ",
    "purpose": "OpenJTDが本文を復元できることを確認する",
    "feature": "plain-text",
    "expected": [{"property": "text", "value": "解析用の本文"}],
    "document": {"kind": "text", "text": "解析用の本文"}
  }]
}
```

ルビ試料:

```json
{
  "schemaVersion": 1,
  "id": "ruby-catalog",
  "samples": [{
    "id": "ruby-reading",
    "title": "範囲付きルビ",
    "purpose": "読みと本文範囲の対応を解析する",
    "feature": "ruby",
    "expected": [{"property": "range[2:4].ruby.reading", "value": "たいしょう"}],
    "document": {
      "kind": "text",
      "text": "甲乙対象丙丁",
      "annotations": [{
        "capability": "ruby",
        "range": {"start": 2, "end": 4, "text": "対象"},
        "parameters": {"reading": "たいしょう"}
      }]
    }
  }]
}
```

Few-shot用の完成ファイルは [examples/agent](../examples/agent) にあります。公開能力ごとの例の存在とvalidationはcheckで検査します。

## 間違った要求

以下は不正な断片です。完成例への追加や置換をしてはいけません。

| 断片 | 不正な理由 |
|---|---|
| `"feature": "auto-ruby"` | 存在しない能力を推測している |
| 一覧で `requestSupported: false` のIDをfeatureに指定 | 内部実装の有無にかかわらず外部要求には使えない |
| `"macro": "Ruby(...)"` | Schemaにない実行手順のフィールド |
| `"document": {"kind":"text","text":"本文","operations":[]}` | Execution Recipeの内部フィールドを混入している |
| 詳細表のmaximumを超える値を指定 | Schemaの値域外 |
| `"range": {"start":2,"end":4,"text":"別物"}` | 本文の該当部分と不一致（意味的検証で拒否） |

## Validationと受け渡し

```sh
node bin/ichitaro.mjs validate examples/agent/03-ruby.json
```

成功時は標準出力に `ok: true` のJSON、終了コード0。失敗時は標準エラーに `ok: false` と `error.code`、`message`、可能なら `path` を出し、終了コード1にします。JSON解析 → Schema検証 → ID・参照・本文範囲・能力・組合せの意味的検証 → 内部計画の検証まで行います。一太郎は起動しません。成功したCatalogをWindows側へ渡してください。

validate成功は生成時の成功保証ではありません。フォント、既定スタイル、属性による折り返しなどの環境依存があり、保存前・再読込後の本文や属性が一致しなければWindows側は失敗として報告します。

Node APIは `validateCatalog(catalog)`（検証要約）と `compileCatalog(catalog)`（独立した要求コピーとRecipe群）です。いずれも [src/sample-catalog.mjs](../src/sample-catalog.mjs) からimportできます。純粋なJSONデータを受け付け、入力は変更しません。

Schemaだけを使う外部検証器はJSON Schema Draft 2020-12、ECMAScript Unicode正規表現に対応させてください。Schema単独ではID参照や本文との一致などを判定できないため、受け渡し前には上記CLIによる検証も必要です。

`schemaVersion` とアプリケーションの `applicationVersion` は別です。前者は要求の互換性、後者は実装リリースを識別します。Schemaが未対応のバージョンなら拒否し、推測で移行しません。能力を増減した場合は同じ配布物のSchema・能力一覧で再検証します。既存のExecution Recipeも `schemaVersion: 1` ですが別形式であり、このvalidateの入力ではありません。

## 文書スタイルの要求

[文書スタイルの例](../examples/agent/10-document-style.json) は `document.style` に設定を置きます。名前付き文字・段落スタイルとは別の、文書全体のレイアウトです。横書き・A4単票縦・游明朝（標準）10.5ポイントを基準とし、初回公開ではフォントの上書きやannotationsとの組合せを受け付けません。

`layoutPriority` が `counts` なら字数・行数、`spacing` なら字間・行間が必須です。四辺の余白も必須です。字間・行間はパーセント、余白はmmで指定します。従属する側の数値は省略すると一太郎が計算し、観測値として記録します。明示した数値は基準値と同じ値でも照合し、一太郎が補正した場合は成功扱いにしません。実際の値域は用紙・フォントなどに依存するため、Schema内の値でも組合せによって実機で不一致になることがあります。

用紙選択、縦書き、見開き印刷、袋とじはこの公開APIの指定対象外です。設定値の読み戻しと本文一致を検証しますが、物理的な配置や画面の再現を保証するものではありません。

一太郎の新規文書の形をそのまま使うときは、`style` の代わりに `document.styleSource: "new-document"` を置きます（[例](../examples/agent/31-new-document-style.json)、CR-001）。基準試料・試料のどちらでも文書スタイルのsetterと `SetDocumentStyle()` を呼ばないので、画面上の値が同じでも、`style` で既定値を明示した文書とは保存値が違うことがあります。`kind: text` だけで、`style`・`font`・`page`・`writingMode`・`columnFormat`・`pageNumber`・`typesetting` とは組み合わせません。範囲の注釈は使えます。文書スタイルのgetterの値は保存前と再読込後に記録して両者の一致だけを確かめ、要求値とは照合しません。結果は一太郎の環境（新規文書のテンプレート）に依存します。

## 省略したルビ・罫線属性

[省略と明示指定の例](../examples/agent/11-application-defaults.json) のように、ルビの `placement`・`sizeMm`・`distanceMm`・`alignment`、罫線表の `lineType`・`color` を省略すると、対応するマクロ引数も省略します。一太郎の公開APIの既定動作を利用し、このアプリの値を補いません。罫線は一太郎の現在の設定に依存するため、試料の再現条件を固定したい場合は明示してください。

省略したルビサイズはgetterで空値（NIL）になる場合があります。その場合、数値に変換せず自動設定状態として記録し、保存・再読込での保持を確認します。具体的なサイズが数値で検証できたとは扱いません。罫線は描画位置・線の存在と観測値の保持を検証します。明示した属性の値との照合、範囲外への漏れの検査は継続します。

従来の外部要求で省略していた属性の結果は変わる可能性があります。以前の値を再現する場合はルビ `placement: above`・`sizeMm: 3`・`distanceMm: 0`・`alignment: distributed`、表 `lineType: 1`・`color: R0G0B0` を明示してください。

## 脚注の最終状態

脚注は [公開例](../examples/agent/12-footnotes.json) の document.kind: footnotes と notes 配列で指定します。本文位置は脚注番号を挿入する前の本文に対する、0始まりの段落番号・文字offsetです。脚注IDは重複させず、同じ本文位置への重複指定も拒否します。詳細な範囲・型は正式Schemaと生成一覧を参照してください。

notesは最終状態の集合です。変更後・削除後の集合を要求できますが、過去文書を編集した履歴の証拠にはなりません。実際のadd / modify / remove履歴を保存・再読込して調べる場合は [脚注の内部Recipe](footnotes.md) を使います。内部番号と数字表示は再採番のタイミングが異なる場合があるため、それぞれの観測値と対応ジャンプの結果を記録します。

## 複数段落の文書と構造要素

ヘッダー／フッター、段組、段落属性、枠、脚注を含む文書は document.kind: paragraphs で指定します。text はLF区切りの短い段落です。headerFooter・columns・paragraphFormats・frames・notes を1つ以上書き、許可された組合せなら同じ文書に同時に書けます。font・page・style は文書全体に適用されます。各要素の最終状態を書き、作成手順は書きません。組合せの可否と実機での検証範囲は [機能の組合せ](combinations.md)、例は [公開例](../examples/agent/19-combinations.json) を参照してください。脚注だけの文書は従来の footnotes でも指定できます。

1つのカタログには200件までの試料を書けます。試料の `repeat: n`（1..10）は同じ要求を n 回、別々のジョブ（`<id>-r1`〜`-rn`、それぞれ独自のbaseline）として作ります。`control: true` は、同じbaselineのJTDを開いて変更なしで別名保存した対照も同じrunに作り、保存ごとのバイトの違いを見積もれるようにします。repeat展開後のジョブも200件までです。

段組には2つの指定場所があります。columns は本文を実際に段組にする段数、columnFormat は文書スタイルに保存される段組の書式（段間・段間罫線・字数）です。columnFormat だけでは本文は段組になりません。両方を指定した場合も、本文の段組区間がその書式で描画されたかは読み戻せないため検証していません。

## 禁則・ジャスティフィケーション

`text` / `paragraphs` 文書の `typesetting` で、ジャスティフィケーション、禁則処理、行頭・行末禁則文字、ぶら下げ、追い込み、括弧類の重なり処理を最終状態として指定できます。ぶら下げを有効にする場合と括弧類の重なり処理を無効にする場合は `pushIn: false` を明示してください。禁則処理を無効にすると、ぶら下げ・追い込み・括弧類の重なり処理は一太郎が無効にします。値と制約の根拠は[禁則・ジャスティフィケーションの設定](typesetting.md)を参照してください。
