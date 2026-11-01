# 開発記録

このフォルダの文書は、開発中の実機検証の記録と、OpenJTD 側の依頼への対応状況です。公開版をひとつの Windows PC で CLI として使うぶんには読む必要はありません。利用者向けの説明は [README](../../README.md) と [docs/](../developer-guide.md) にあります。

| 文書 | 内容 |
|---|---|
| [openjtd-requests-20261014.md](openjtd-requests-20261014.md) | OpenJTD 側の依頼 APP-01〜19 の対応状況 |
| [sample-contract-report.md](sample-contract-report.md) | v0.12 当時の契約の報告 |
| [table-request-validation-20261011.md](table-request-validation-20261011.md)、[document-structure-development.md](document-structure-development.md)、[paragraph-development.md](paragraph-development.md)、[table-structure-development.md](table-structure-development.md)、[ruby-size-tolerance.md](ruby-size-tolerance.md) | 開発中の実機検証の記録 |

文書やテストに出る `CR-nnn` は、作者が能力追加に付けた通し番号です。

記録の中の実機の run（`runs/`・`tmp/`・`output/`）への参照は、実験ストレージのある環境で `npm run check:evidence` が検査します（[開発者ガイド](../developer-guide.md)）。
