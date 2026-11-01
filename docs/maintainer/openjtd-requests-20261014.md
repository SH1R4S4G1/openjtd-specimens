# OpenJTDからの依頼（APP-01〜19）の対応状況

OpenJTD側（検証担当）から2026-10-14に受け取った依頼一覧への対応状況です。依頼はアプリv0.12.0とSample Catalog v1を前提に書かれています。原本（`REQUESTS.ja.md`・`requests.json`・受け入れ確認用の `acc14.catalog.json` など）はリポジトリに取り込まず、実験ストレージの `output/openjtd-requests-20261014/` に保管しています。原本は依頼者側の文書なので、ここでは要望を要約し、判断と根拠だけを記録します。

現行の公開範囲・値域・制限の正本は[生成Capability詳細表](../generated/sample-capabilities.md)と `capabilities.json` です。この表は判断の経緯を残すためのもので、仕様の正本ではありません。

## 判断の方針

依頼の確認時に、次の方針を決めました。

- 受け入れ条件のうち、一太郎内部の保存構造に関するもの（APP-08の「ブロック分割が起きる長さ」、APP-02の「ルビ文字に文字書式の範囲を作らない」）は、このアプリの検証対象外とします。保存構造の解析はOpenJTD側の役割です。
- APP-16の「字数と字間が両立しない組合せを実行前に分かる」はOpenJTD側で確認します。
- APP-18（文字の座標）は見送ります。PDF出力（APP-03）は印刷経路ではなく、保存時の形式指定で行います。
- APP-15では、読み戻しの不一致は記録して続行します。結果が不明なタイムアウトでは止める方針を保ち、integrity・completion・acceptanceを区別したままにします。
- APP-01・APP-06の指定場所は、現行の仕様（文書直下の `page` など）のままとします。
- APP-04の配布物は、実験ストレージ側の書き出し機能とします。ハッシュは既存のrunのmanifestと `verifyRun` の記録から取り、二重に管理しません。

## 対応状況（2026-10-15時点）

| ID | 要望（要約） | 状態 | 内容・根拠 |
|---|---|---|---|
| APP-01 | `text` 文書で `style`・`font`・`annotations` を併用する | 対応済み | 併用を受理し、文書スタイル→フォント→注釈の順で適用します。[試料要求仕様](../sample-request-spec.md) |
| APP-02 | ルビのサイズ省略時の実値、「書式なし」の明示指定 | 一部対応 | 省略した引数はマクロ呼出しから外し、getterの値（NILを含む）を証跡に記録します。[ルビサイズの許容差](ruby-size-tolerance.md)。「書式なし」の明示指定は未着手です |
| APP-03 | 結果ファイルの拡張とPDF | 対応済み | `execution-results.json` v2に要求値・保存前と再読込後の実値・差分・証明・ハッシュ・版を集約しました。`--pdf` で `SaveDocument` の形式23によりPDFを保存し、JTDが変わらないことを確認します。[実行ガイド](../execution-agent-guide.md) |
| APP-04 | 配布物の `package-manifest.json` | 対応済み（実験ストレージ側） | `bin/ichitaro-package.mjs` が既存の証跡のハッシュからmanifestを作り、コピーを照合します。zipは作りません |
| APP-05 | 要求しない文書スタイルの実値も常に記録する | 対応済み | 全試料で、文書スタイルの数値・単位・方向・フォント・用紙・段組書式・ページ番号・体裁を、保存前と再読込後に記録します |
| APP-06 | 用紙・縦書き・段組書式の公開 | 対応済み | 指定場所は文書直下の `page`・`writingMode`・`columnFormat` です（依頼の案の `documentStyle` 内ではありません）。[用紙と縦書きの完成例](../../examples/agent/17-paper-and-writing.json)、[段組書式の完成例](../../examples/agent/21-column-format.json) |
| APP-07 | 太字・斜体・文字色・範囲ごとの書体 | 対応済み | `character-font-style`・`character-color`・`character-font` を公開しました。太字と斜体の同時指定は、一太郎が反映しないため理由付きで拒否します。[完成例](../../examples/agent/27-character-style.json) |
| APP-08 | 本文の上限を2000字程度に | 対応済み | 本文は最大2000字で、全文字を順に読み戻して照合します。[範囲レシピ](../range-recipes.md)、[完成例](../../examples/agent/26-long-text.json) |
| APP-09 | 複数段落の本文と段落ごとの属性 | 一部対応 | `text` 文書はLF区切りの複数段落を持てて、範囲注釈は1つの段落の中に置けます。段落属性は `paragraphs` 文書で指定できますが、範囲注釈との併用はできません |
| APP-10 | 段落属性・タブ・段落飾り | 一部対応 | 段落属性とタブは公開済みです。[段落書式の完成例](../../examples/agent/16-paragraph-formats.json)、[タブの完成例](../../examples/agent/22-paragraph-tabs.json)。段落飾りはgetterがないため未公開です |
| APP-11 | 禁則・両端揃え・約物の詰め | 対応済み | ジャスティフィケーション・禁則処理・禁則文字・ぶら下げ・追い込み・括弧類の重なり処理を公開しました。`text` 文書と、構造要素を含む `paragraphs` 文書の両方で実機確認済みです。約物の詰めはマクロに引数がありません。[禁則・ジャスティフィケーションの設定](../typesetting.md) |
| APP-12 | 表の拡張（セル文字・3×3以上・結合・行高列幅） | 対応済み | 最大4×4、行高・列幅、結合、セル文字を最終状態で指定できます。[罫線レシピ](../keisen-recipes.md)、[完成例](../../examples/agent/29-table-structure.json) |
| APP-13 | ヘッダー・フッター・本文の段組区間・名前付きスタイル | 対応済み | [ヘッダー・フッターの完成例](../../examples/agent/20-header-slots.json)、[段組区間の完成例](../../examples/agent/25-column-range.json)、[名前付きスタイルの完成例](../../examples/agent/23-named-styles.json) |
| APP-14 | 試料数200件、反復・対照の宣言 | 対応済み | 1カタログ200件、`repeat`・`control` に対応しました。[完成例](../../examples/agent/28-repeat-control.json) |
| APP-15 | 試料単位の失敗の記録と続行・再開 | 一部対応 | 読み戻しの不一致は `READBACK_MISMATCH` として記録して続行します。タイムアウト・マクロエラー・整合性の失敗では止めます。完了済みを飛ばす再開（resume）は未実装です |
| APP-16 | `validate` での意味的な拒否 | 対象外（一部は既存） | 組合せ・値の依存関係の拒否はコンパイル時に行います。字数と字間の両立の事前判定はOpenJTD側で確認します |
| APP-17 | 受理されるフォント名・用紙名の一覧 | 未着手 | |
| APP-18 | 文字の座標の記録 | 見送り | 範囲の読み戻しでは `GetPosition` の座標を証跡に記録だけしています。照合への切替条件は[範囲レシピ](../range-recipes.md)にあります |
| APP-19 | 成果物が何回目の保存かの明記 | 対応済み | `execution-results.json` の `saves` に、baselineは新規文書の初回保存、要求試料はbaselineを開いて別名で保存したJTDであることを記録します |

状態を変えたときは、この表と根拠のリンクを更新してください。
