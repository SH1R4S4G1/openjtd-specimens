# 密着・均等割付の試料（v0.6）

優先度2の密着・均等割付を、既存の範囲レシピ、台帳、JTD観測機能に追加しました。横書き・短い単一段落の制約は [範囲レシピ](range-recipes.md) と共通です。数値字間の `spacing` とは別の属性です。

```powershell
node bin/ichitaro-macro.mjs examples/allocation-ranges.json runs
node bin/ichitaro-macro.mjs examples/allocation-boundaries.json runs
node bin/ichitaro-catalog.mjs catalogs/my-allocation --run runs/<run-id>
node bin/ichitaro-observe.mjs run runs/<run-id>
```

## レシピ

`type:"character"`、`target` に既存の範囲IDを指定します。いずれも対象は2文字以上です。

| attribute | mode | 引数 | マクロ |
|---|---|---|---|
| `closely` | `set` / `clear` | value/unitなし | `CloselySpacing(1/0)` |
| `evenly` | `set` | value, unit, widthMode | `EvenlySpacing` |
| `evenly` | `modify` | value, unit, widthMode | `ModifyEvenlySpacing` |
| `evenly` | `clear` | value/unit/widthModeなし | `CancelEvenlySpacing` |

```json
{"target":"middle","type":"character","attribute":"evenly","mode":"set","value":8,"unit":101,"widthMode":1}
```

均等の単位は `1: mm`、`2: inch`、`3: point`、`101: column`。`widthMode` は `1: 絶対幅`、`2: 相対幅` です。相対幅の基準は、新規設定では選択領域の幅、変更では現在の均等幅です。受理する数値にはアプリ側の暫定上限 ±100 を設け、絶対幅は正数としています。この上限は一太郎の仕様上限ではありません。設定による折り返しなどで本文照合が一致しなければ、検証エラーで停止します。

均等の変更・解除には、同じ試料内・同じ対象への先行する設定が必要です。設定済み範囲への新規設定や、重なる均等対象は実行前に拒否します。隣接する異なる範囲は使用できます。

## 検証の強さ

- 密着・均等の有無は `IsCloselySpacing` / `IsEvenlySpacing` を全文字で取得し、対象内の期待値と対象外の不変を検査します。
- 保存前と再読込後の文字列、文字属性、文字情報、専用getter、位置を照合します。
- **均等幅は未検証です。** `widthVerified:false` と指定値・単位・指定方法を記録します。変更マクロが完了して設定ありを返しても、幅が指定どおり変わったとは断定しません。
- 各中間段階を観測しますが、独立に保存・再読込するのは試料の最終状態です。
- 画像による幅の確認は追加していません。`GetPosition` も参照しましたが、確認したページには返却座標の単位が明記されておらず、指定幅の検証には採用していません。

台帳の「保存・再読込確認済み」は、この観測範囲についての段階です。引数すべての意味や全値域を検証済みという意味ではありません。試料HTMLにも未確認の幅とgetter間の不一致を表示します。

## 実機で見つかった挙動

密着解除後、`IsCloselySpacing` が FALSE、`GetCharacterInformation` の密着割付が TRUE を返す例がありました。後者を勝手に補正せず、両方を生データに残し、`rangeProof.getterDisagreements` に列挙します。検証成功は専用getterについての一致を表します。不一致の原因や内部データの意味は未確定です。

均等を設定すると、本文文字列には現れない空のカーソル位置が増える例があります。均等操作を含む試料では、各段階で空位置を読み飛ばして本文文字とカーソル位置を対応付け直します。読み飛ばした位置は `rangeProof.navigation` に記録し、各文字の同一性と対象選択を検査します。走査には上限を設けています。

均等解除はブロック単位です。文字数をそのままブロック移動量にすると隣接範囲を巻き込む例を検出したため、公開ヘルプの例に沿って対象の末尾文字から左へ1カラムの内部ブロックを指定します。指定したブロック座標は生のマクロ結果に残し、実行後は対象外の全文字を検査します。文字位置とブロックの桁座標は同じ単位として扱いません。

失敗試料もrunに保存し、台帳の成功証跡には昇格させません。成功例に合わせて対象外の検査を緩めることはしていません。

## 検証結果

一太郎2026で最終版の18試料を作成し、すべて対象外検査・保存／再読込・証跡ハッシュの整合性検査を通過しました。均等幅の検証を含む数字ではありません。自動テスト117件と構文検査も成功しています。

| レシピ | 試料数 | 時間 | run |
|---|---:|---:|---|
| `allocation-ranges.json` | 10 | 約57秒 | `2026-10-09T23-49-07-204Z-4a62f9d1` |
| `allocation-boundaries.json` | 8 | 約50秒 | `2026-10-09T23-47-35-558Z-77db1535` |

台帳は `catalogs/allocation-v06/index.html`。優先度0～2の6能力について、実装段階と条件付きの保存・再読込証跡を確認できます。観測レポートは `observations/allocation-v06/index.html` で、21候補領域を抽出しました。形式上の意味は確定していません。幅が違っても同じ有無を返す試料は、現在の観測器では同じ観測群に入り得ます。その場合に幅に関する差分を反復内変動として除外し得る点もレポートに記載しています。

## 出典

添付された公開マクロヘルプの `CloselySpacing:t26m1xpj`、`IsCloselySpacing:t26m6t0n`、`EvenlySpacing:t26m3qsn`、`ModifyEvenlySpacing:t26m93on`、`CancelEvenlySpacing:t26m1zs7`、解除の文例 `t26m27w3`、`IsEvenlySpacing:t26m9lnr`、`GetCharacterInformation:t26m90ku`、`GetPosition:t26m9j1q` を確認しました。JTDは正規アプリケーション自身に作成させ、バイナリの書換えやDLL解析は行っていません。

次の優先度はルビです。明示した読みの設定・変更・解除を、同じ範囲と証跡の枠組みに追加する予定です。
