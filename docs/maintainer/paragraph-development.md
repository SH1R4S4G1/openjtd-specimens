# 段落書式の実装・実機記録

## 目標と境界

2026-10-12の目標は、揃え・インデント・段落間隔を一属性ずつ設定・変更・解除・再読込まで検証し、続いてタブ、段落飾りへ広げることです。罫線の複合条件は[既知の制限](table-structure-development.md)を残していったん区切ります。未対応条件を検証済みにしません。文書構造へ進むかセル属性継承へ戻るかは、この目標の後に判断します。

## 公開仕様と実機での発見

- `ParagraphAttribute`：T36MAC/html/t26m806d.htm。省略した引数は維持する仕様。
- `GetParagraphAttribute`：t26m9nj9.htm。未設定値はnil。実機では23項目の配列に空の値が戻る。引数名とgetterキーの全角・半角表記に差があり、実機のキーをコードに記録した。
- `CancelParagraphAttribute`：t26m1s9x.htm。解除フラグは省略時trueなので、全13引数を明示する。インデントは4成分と単位、段落間隔は上下と単位が一括解除される。
- `NextParagraph`：t26m5kdk.htm。表示行番号に依存せず段落先頭へ移動する。RangeMode(3)、RangeStart/Endで段落全体を選ぶ。
- 行頭インデントだけを指定すると、先頭行シフトが逆符号へ連動した。単属性試験では同じグループの他成分を明示的に0へ固定する。
- 先頭行の行末シフトは、この基準条件で正値を指定すると一太郎がConstraintErrorを返した。正値を未対応とし、内向きの負値を試験する。一般的な値域が判明したとはしない。

## 2026-10-12：揃え・インデント・段落間隔

[paragraphs.mjs](../../src/paragraphs.mjs)に範囲、操作、全段落の本文・23項目の属性取得、数値と未設定を区別する比較器を実装した。内部RecipeのparagraphTargetsとparagraphOperationsで使う。文字範囲・罫線との複合、外部Sample Catalogへの公開は行わない。

[単属性Recipe](../../examples/paragraph-attributes.json)の29試料（baselineを含む）が[実機run](../../runs/2026-10-12T01-45-19-953Z-ce743317/index.html)で保存・再読込確認に成功。揃え、行頭／行末インデント、先頭行の行頭／行末シフト、前後の段落間隔について、設定・変更・解除・再設定の最終状態をそれぞれ別のJTDに保存している。対象外の前後段落も毎回比較する。

[初回run](../../runs/2026-10-12T01-42-17-981Z-023be8c2/index.html)は正値の先頭行行末シフトで停止した。done通知とConstraintErrorを確認済み。失敗条件は成功証跡として使用しない。

## 2026-10-12：タブと段落飾り

タブの公開仕様はParagraphAttributeの位置配列・単位・種類配列。種類は引数で指定できるが、今回の[プローブ結果](../../tmp/paragraph-tabs-probe-live.txt)では位置と単位のみ取得でき、種類はnilのままだった。位置の配列を読めたことから種類の一致まで推測しない。プローブは最後の再設定状態だけを保存しており、設定・変更・解除を各々保存する通常Recipeの証跡ではない。

段落飾りはParagraphDecoration（t26m1sby.htm）とCancelParagraphDecoration（t26m3qni.htm）の公開仕様を確認。専用getterはまだ確認できていない。枠用のGetFrameDecorationを段落飾りのgetterと取り違えない。

[タブRecipe](../../examples/paragraph-tabs.json)は[通常run](../../runs/2026-10-12T04-18-46-880Z-55f16884/index.html)の9試料で保存・再読込確認に成功。GetStringはタブを空白として返すため、GetCharacterType=9と各文字のGetCharacterを全段落で照合する。種類配列を省略するとConstraintErrorになるため左タブを明示するが、種類自体はgetterで確認できず未検証のまま。

[段落飾りRecipe](../../examples/paragraph-decoration.json)は内部属性decorationLineで黒の全周囲み線種だけを扱う。設定・変更・なし指定・再設定を独立した試料として保存する。色・影・塗り・背景などは固定し、複合操作は扱わない。CancelParagraphDecorationは段落選択でもブロック選択でも始点入力待ちになったため使用しない。なし指定はParagraphDecorationの囲み種類0を使い、内部の飾りレコードを消去したとは主張しない。

[段落飾りrun](../../runs/2026-10-12T04-33-51-706Z-9d4bfba5/index.html)は基準1試料と操作4試料を保存・再読込した。操作試料はreviewRequired=true、decorationVerified=false、status=savedを維持する。本文と他の段落属性の比較が成功した場合だけ次の試料へ進む。不一致や保存失敗は停止する。通常の観測値との関連付けレポートには未検証試料を渡せない。

[画面証跡](../../observations/paragraph-decoration-visual-20261012/index.html)では、設定・変更・再設定後の囲みと、なし指定後の囲み消失を目視した。前後段落への見える囲みの漏れはない。画像とJTDのハッシュを対応付け、表示の前後でJTD不変を確認した。これは定性的な見た目の証跡であり、線種コードの読み戻しや内部レコード消去の証明ではない。台帳ではpendingReviewEvidenceに別掲し、getterによる実機検証・再読込確認の件数へ加算しない。

段落飾りの全引数、描画寸法、混在文字書式、縦書き、外部Sample Catalogへの公開は未対応。次の拡張でも画面確認と数値getter検証を分ける。

## 観測と次の試験

[基本段落の差分観測](../../observations/paragraphs-20261012/index.html)と[タブの差分観測](../../observations/paragraph-tabs-20261012/index.html)はgetter検証済み試料だけを関連付ける。2026-10-12のタブ9試料では候補16領域、同条件群内変動9位置を報告した。候補は形式の解読結果ではない。両方のnext-probes.jsonは段落対象と全操作履歴を保持し、plan検証を通した未実行Recipe。

段落飾りは[遷移ごとのバイト比較](../../observations/paragraph-decoration-pairs-20261012/transitions.json)だけを作成した。設定値との相関には昇格させない。[更新台帳](../../catalogs/paragraph-decoration-20261012/index.html)のJSONには4試料のpendingReviewEvidenceを記録し、自動検証の証跡と分離する。

## 2026-10-12：線色・塗り濃度・パターンの追加

[色・塗りRecipe](../../examples/paragraph-decoration-color-fill.json)でdecorationColorとdecorationFillを追加した。前者は囲み線のRGB、後者は黒の塗り濃度またはパターンを指定する。1試料1属性、同一の囲み線種と線幅、影・背景なしを固定する。clearは囲みと塗りを一括でなしに戻す操作であり、色だけ／塗りだけの個別解除ではない。明示的な塗り0は囲みを残すためclearと区別する。

[実機run](../../runs/2026-10-12T10-10-16-752Z-bd4ee1c7/index.html)では、線色の赤→青、濃度25→50、パターン101→107について設定・変更・解除要求・再設定を保存・再読込した。基準1試料はverified、操作12試料はsaved・reviewRequired。本文・他の段落属性には不一致なし。全値域を実機確認したわけではない。

[代表画面4試料](../../observations/paragraph-color-fill-visual-20261012/index.html)で青い線、灰色の塗り、模様の塗り、解除後の消失を目視した。元JTDのハッシュ不変を確認した。残り8操作試料は今回の画面確認を行っていない。RGB・濃度・パターン番号の正確な取得は引き続き未対応。

[台帳](../../catalogs/paragraph-color-fill-20261012/index.html)はpendingReviewEvidenceへ追加し、自動検証件数には算入しない。[遷移別バイト比較](../../observations/paragraph-color-fill-pairs-20261012/transitions.json)も12組作成したが、属性値との対応付けは推論しない。影・塗り色・背景・丸め・距離などは今後の対象。

## 区切り：未対応条件（2026-10-12）

段落飾りの影（位置・色・幅）、塗り色、背景（単色・グラデーション）、角丸、文字との距離、縦書き、段落飾り同士または文字／段落属性との複合条件は未対応として保留する。全値域、描画寸法、内部レコードの解除状態も検証済みとしない。次は[文書構造](document-structure-development.md)へ進む。

## 2026-10-14 グループ単位の設定と外部公開

字下げ（行頭・行末・先頭行行頭・先頭行行末）と段落間（前・後）を、1回の呼出で全成分を書く内部属性 `indent` / `paragraphSpacing` として追加した。指定しない成分は0を書き、期待値もグループ全体で照合する。文字揃え・字下げ・段落間は、全スロットのgetterで照合できるため1試料内で組み合わせられる。タブと段落飾りは従来どおり単独試験に限る。

内部Recipe [paragraph-grouped.json](../../examples/paragraph-grouped.json) の7試料（カラム単位の3成分、mmのぶら下げ、mm・%の段落間、3属性の複合、同一グループの再設定と解除）が実機でverified（[run](../../runs/2026-10-14T02-07-14-952Z-2bf4e131/index.html)）。再設定で前の成分が0へ戻り、解除で未設定に戻ることも読み戻し値で確認した。

外部要求では `paragraphs` 文書の `paragraphFormats`（`paragraph-attribute`）として最終状態を公開した。[公開例](../../examples/agent/16-paragraph-formats.json)の6要求・12試料が実機でverified（[結果](../../tmp/public-paragraphs-20261014-r2/execution-results.json)）。最初の実行（[run](../../runs/2026-10-14T02-09-33-230Z-20399bc5/index.html)）は3要求目で証跡の `events.json` 置換がWindowsの一時的な `EPERM` で失敗して停止した。一太郎の読み戻し不一致ではない。この失敗runは成功扱いにせず残し、証跡書込みのrenameに一時的エラーだけの短い再試行を追加して全要求を再実行した。

## 2026-10-14 タブ位置の外部公開

`paragraphFormats[].tabs`（`paragraph-tabs`）として、タブ位置（mmは60まで、カラムは20まで、1..8個の昇順）を公開した。タブ位置と単位は全段落・全23スロットのgetterで照合する。本文中のタブ文字は `GetString` では空白になるため、各位置で `GetCharacterType=9` を確認する。タブ種類は左揃えで呼び出すがgetterがnilを返すため検証していない。

タブはgetterで照合できるため、文字揃え・字下げ・段落間と同じ試料で組み合わせられるようにした（段落飾りは引き続き単独）。本文にタブ文字を含められるのは、`paragraphFormats` だけの文書に限る。ヘッダー・段組・枠の本文照合は `GetString` を使い、タブを空白として返すためである。

[公開例](../../examples/agent/22-paragraph-tabs.json)の3要求・6試料（mm、カラムでタブ2つ、中央揃え・字下げとの組合せ）が実機でverified（[結果](../../tmp/public-tabs-20261014/execution-results.json)）。組合せ試料では、再読込後に第1段落の文字揃え2、第2段落の字下げ2カラム・タブ位置[6]カラム・タブ文字種9を確認した。
