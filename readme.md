# FongMi / 影视TV 订阅

适用于支持 QuickJS Spider 的 FongMi / 影视TV 客户端。复制下方 JSON 链接，填入客户端的配置地址。

## 组合订阅

- [18.json](https://raw.githubusercontent.com/lang233/tvbox-feeds/main/18.json)：黄果短剧、麻豆

## 单站点订阅

- [黄果短剧](https://raw.githubusercontent.com/lang233/tvbox-feeds/main/sites/huangguo.json)
- [麻豆](https://raw.githubusercontent.com/lang233/tvbox-feeds/main/sites/madou.json)

## 文件说明

- 根目录 JSON：组合订阅。
- `sites/`：单站点订阅，可用于单独导入和排查问题。
- `spiders/`：订阅引用的爬虫脚本，由客户端自动加载。

本目录由构建流程自动生成。订阅和站点变化后，说明及链接会在下次构建时同步更新。
