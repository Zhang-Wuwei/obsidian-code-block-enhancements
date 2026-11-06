"use strict";
// CPython 官方发布页 SHA-256；wheel 元数据来自 PyPI 对应固定版本 JSON。
module.exports = {
  runtime: { name: "python-3.14.10-embed-amd64.zip", size: 12619664,
    url: "https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip",
    sha256: "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159" },
  wheels: [
    ["black-26.10.1-py3-none-any.whl", "b1/28/9dd29175c1db777e6189e2a0bb5f37101adf19c3e509b236c8920f778d0b", 239267, "28842f9a8207cc1df6eb983a35a14c5a0dfcd603d214fe82d84bef552afd2e3a"],
    ["click-8.5.0-py3-none-any.whl", "58/50/6c0d534c5f134586a8e1ba4e330569e32f057e33372ae556463212fb4cd3", 125251, "255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360"],
    ["mypy_extensions-1.2.0-py3-none-any.whl", "b5/99/7b1adac7e97ce7bbda34792dc6e9b2f5cc5cffd1875883f78a818b2a2687", 5114, "993e7a20aa5671eb41a7132cf555af30062da99729601601b9a8382b11cae768"],
    ["packaging-26.3-py3-none-any.whl", "63/34/ba1c580383c9eada3711951fef0795c80b829a078d72188184bcab9dd527", 129956, "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c"],
    ["pathspec-1.1.1-py3-none-any.whl", "f1/d9/7fb5aa316bc299258e68c73ba3bddbc499654a07f151cba08f6153988714", 57328, "a00ce642f577bf7f473932318056212bc4f8bfdf53128c78bbd5af0b9b20b189"],
    ["platformdirs-4.14.5-py3-none-any.whl", "7c/ae/ecbbbfd0e4343a6a521d49b3c8656fb4643dee2a4f6eaf941cf3280391a8", 35402, "8e778c6fa421516f4d3369449f8df3b0e1b72c0e0005fe88e3ec772d0a14e750"],
    ["pytokens-0.4.1-py3-none-any.whl", "c6/78/397db326746f0a342855b81216ae1f0a32965deccfd7c830a2dbc66d2483", 13729, "26cef14744a8385f35d0e095dc8b3a7583f6c953c2e3d269c7f82484bf5ad2de"]
  ].map(([name, key, size, sha256]) => ({ name, url: `https://files.pythonhosted.org/packages/${key}/${name}`, size, sha256 }))
};
