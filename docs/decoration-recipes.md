# 文字装飾・文字囲み罫線（v0.8）

優先度4として、下線・取消線・文字囲み・塗りつぶしを追加しました。文字囲みは台帳の独立した能力です。段落飾り、本文の罫線、罫線表とは別に管理します。対象本文の制約は [範囲レシピ](range-recipes.md) と共通です。

```powershell
node bin/ichitaro-macro.mjs examples/decoration-ranges.json runs
node bin/ichitaro-macro.mjs examples/decoration-boundaries.json runs
node bin/ichitaro-catalog.mjs catalogs/my-decoration --run runs/<run-id>
node bin/ichitaro-observe.mjs run runs/<run-id>
```

## 外部要求API（2026-10-14）

Sample Catalogの範囲注釈として `character-decoration`（下線・取消線・塗りつぶし）と `character-border`（文字囲み）を公開しました。[公開例](../examples/agent/13-character-decoration.json) のように1範囲の最終状態を指定します。一太郎は文字ごとに飾り色を1色だけ持つため、`color` は範囲内の全装飾で共有します。同じ範囲に文字囲みと他の装飾を重ねる場合は、注釈が重なるため外部要求では指定できません（内部Recipeでは可能）。正確な型・値域は[公開能力表](generated/sample-capabilities.md)を参照してください。

コンパイラは下線→取消線→塗りの固定順で、同じ色を各呼出へ渡すset操作に変換します。外部要求からの6要求・12試料（単独・同一範囲の3装飾と共有色・文字囲み・別範囲の文字囲みと下線）が実機でverifiedになり、全runの `verifyRun` も成功しました。結果は[execution-results.json](../tmp/public-decoration-20261014/execution-results.json)にあります。

## レシピ

```json
{"target":"middle","type":"character","attribute":"border","mode":"set","value":3,"color":"R255G0B0"}
```

| attribute | マクロ | setのvalue | 読み戻し |
|---|---|---|---|
| `underline` | `Underline` | 線種1～15 | アンダーライン |
| `strikeThrough` | `StrikeThrough` | 線種1～15 | 取消ライン |
| `border` | `CharacterBorder` | 線種1～15 | 文字囲い |
| `fill` | `Style` の塗りつぶし引数 | 濃度1～100、パターン101～107 | 塗りつぶし |

同じ対象へ `set → set` と並べると値を変更します。解除は `mode:"clear"` とし、value/colorを指定しません。解除では対象属性に0を設定します。塗りつぶし濃度0もclearで指定します。

`color` は省略可能です。指定する場合は `R0G0B0` 形式で、各成分0～255を使います。パレット番号は今回のレシピでは受理しません。先頭のゼロは正規化してからマクロへ渡します。

**色は対象文字の共通の「飾り色」です。** 例えば青い下線のある文字に赤い囲みを追加すると、getterの飾り色も赤になります。各装飾に別々の色を保持できるとは扱いません。colorを省略した設定、またはclearでは共通色を変更しません。

線のマクロは追加モード1で実行し、他の飾りを一括解除する上書きモード2は公開しません。`Style` は塗りつぶしと任意の飾り色だけを指定し、他の引数を省略して保持します。

## 検証

`GetCharacterAttribute` で、各文字の線種・濃度／パターン・指定色を照合します。対象外の文字だけでなく、**対象内の指定していない文字属性、文字情報、ルビも操作前後で比較**します。これにより、囲みを解除した際に下線まで失われたような変更も検出します。

共通色を明示して変更した場合は、その色の変化を要求した変更として扱います。それ以外の属性を検査から除外することはありません。本文・対象選択・位置の確認、保存前と再読込後の一致も従来どおり行います。

検証の強さは `exact-decoration-and-unrequested-state` として各操作に記録します。解除はgetterが0になったことの確認です。内部の属性記録が消えたことや、明示値と継承状態の区別を証明するものではありません。中間操作を観測しますが、保存・再読込は試料の最終状態についてです。

線種番号とパターン番号はAPIのコード値として記録します。各コードの見た目、線幅、囲みの実寸、印刷結果は今回測定していません。

## 試料と未対応

基本レシピはbaseline/controlと4属性それぞれの設定・変更・色指定・解除・再設定です。境界レシピは、先頭、同文2回目、末尾1文字、隣接範囲の片方の解除、共通色の変更、複数装飾の一部だけの解除を扱います。

実機では線種1・3・15、塗りつぶし50・101・107、RGBの赤・青を試験対象にしています。受理する全コード値を実証したという意味ではありません。

`Style` の上線・中抜き・反転・回転・傍点・影文字は未対応です。既存のgetterでは観測しますが、試料レシピからの設定は受理しません。段落飾り、本文罫線、罫線表はv0.8の対応に含めませんでした。後続版では[本文罫線・罫線表](keisen-recipes.md)を限定実装しています。現行の状態は [capabilities.json](../capabilities.json) を参照してください。

## 実機結果

一太郎2026で29試料すべてが保存・再読込と証跡整合性の検査を通過しました。自動テスト119件と構文検査も成功しています。

| レシピ | 試料数 | 実行時間 | run |
|---|---:|---:|---|
| `decoration-ranges.json` | 22 | 約116秒 | `2026-10-10T04-58-29-232Z-b3c9edc8` |
| `decoration-boundaries.json` | 7 | 約37秒 | `2026-10-10T05-00-36-907Z-c49c05b6` |

台帳は `catalogs/decoration-v08/index.html`。無変更のcontrolを明示的な比較基準にした観測レポートは `observations/decoration-v08-control/index.html` です。現行の保守的な候補計算では、長さ等が変わる2ストリームを除外し、1候補領域を抽出しました。各試料の個別バイト差分は候補の有無にかかわらず保存します。候補は形式上の意味を確定するものではありません。

## 出典

添付公開ヘルプ `Underline:t26m0j8l`、`StrikeThrough:t26m9o2w`、`CharacterBorder:t26m4y7m`、`Style:t26m5ucl`、`GetCharacterAttribute:t26m5gf9` を参照しました。JTDは正規一太郎自身に作成・保存させています。
