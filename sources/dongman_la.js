/** @type {import('./_venera_.js')} */
class DongmanLa extends ComicSource {
  name = "动漫啦"

  key = "dongman_la_v3"

  version = "2.0.1"

  minAppVersion = "1.0.0"

  // 更新地址：当前没有维护中的远程脚本地址，显式留空（不要把漫画站首页误当更新地址）
  url = ""

  siteUrl = "https://www.dongman.la"

  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                            */
  /* ------------------------------------------------------------------ */

  headers() {
    return {
      "User-Agent": this.userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": this.siteUrl + "/",
    };
  }

  // 有限重试：只对连接层异常重试一次；HTTP 状态码与错误页直接抛出，保留真实证据
  async fetchText(url) {
    let lastError = null;
    for (let i = 0; i < 2; i++) {
      let res = null;
      try {
        res = await Network.get(url, this.headers());
      } catch (e) {
        lastError = e;
        res = null;
      }
      if (res) {
        if (res.status !== 200) {
          throw "请求返回状态码 " + res.status + ": " + url;
        }
        if (!res.body || res.body.length < 32) {
          throw "响应内容过短，疑似错误页: " + url;
        }
        return res;
      }
    }
    throw "请求失败: " + url + " (" + (lastError ? lastError.toString() : "unknown") + ")";
  }

  async withDocument(url, callback) {
    let res = await this.fetchText(url);
    let doc = new HtmlDocument(res.body);
    try {
      return callback(doc);
    } finally {
      doc.dispose();
    }
  }

  absoluteUrl(value) {
    if (!value) return "";
    let u = value.trim();
    if (u.length === 0) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
    if (u.charAt(0) !== "/") u = "/" + u;
    return this.siteUrl + u;
  }

  comicIdFromHref(href) {
    if (!href) return null;
    let m = String(href).match(/\/manhua\/detail\/(\d+)/);
    return m ? m[1] : null;
  }

  digitsOnly(value) {
    let m = String(value == null ? "" : value).match(/(\d+)/);
    return m ? m[1] : null;
  }

  /* ------------------------------------------------------------------ */
  /* 列表解析                                                            */
  /* ------------------------------------------------------------------ */

  // 首页分区卡片：a.comic-card
  parseGridCard(card) {
    let id = this.comicIdFromHref(card.attributes["href"]);
    if (!id) return null;
    let titleEl = card.querySelector("h3");
    if (!titleEl) titleEl = card.querySelector("h2");
    let title = titleEl ? titleEl.text.trim() : "";
    if (!title) {
      title = card.attributes["title"] || "";
    }
    if (!title) return null;
    let img = card.querySelector("img");
    let cover = "";
    if (img) {
      cover = img.attributes["src"] || img.attributes["data-cover"] || img.attributes["data-src"] || "";
    }
    let statusEl = card.querySelector(".cover-status");
    let latestEl = card.querySelector("p");
    let tags = [];
    if (statusEl && statusEl.text.trim()) tags.push(statusEl.text.trim());
    return new Comic({
      id: id,
      title: title,
      cover: this.absoluteUrl(cover),
      subtitle: latestEl ? latestEl.text.trim() : "",
      subTitle: latestEl ? latestEl.text.trim() : "",
      tags: tags,
    });
  }

  // 分类 / 搜索列表项：ul > li（两页同一模板）
  parseListItem(li) {
    let linkEl = li.querySelector('a[href^="/manhua/detail/"]');
    if (!linkEl) return null;
    let id = this.comicIdFromHref(linkEl.attributes["href"]);
    if (!id) return null;
    let titleEl = li.querySelector("h2 a");
    if (!titleEl) titleEl = li.querySelector("h2");
    let title = titleEl ? titleEl.text.trim() : "";
    if (!title) return null;
    let img = li.querySelector("img");
    let cover = "";
    if (img) {
      cover = img.attributes["src"] || img.attributes["data-src"] || "";
    }
    let tags = [];
    let author = "";
    let spans = li.querySelectorAll("span");
    for (let i = 0; i < spans.length; i++) {
      let t = spans[i].text.trim();
      if (t.indexOf("状态：") === 0) {
        let statusText = t.substring(3).trim();
        if (statusText) tags.push(statusText);
      } else if (t.indexOf("作者：") === 0) {
        author = t.substring(3).trim();
      } else if (t.indexOf("标签：") === 0) {
        let raw = t.substring(3).trim();
        let parts = raw.split(/[,，、\s]+/);
        for (let j = 0; j < parts.length; j++) {
          let p = parts[j].trim();
          if (p && tags.indexOf(p) < 0) tags.push(p);
        }
      }
    }
    let descEl = li.querySelector("p");
    return new Comic({
      id: id,
      title: title,
      cover: this.absoluteUrl(cover),
      subtitle: author,
      subTitle: author,
      tags: tags,
      description: descEl ? descEl.text.trim() : "",
    });
  }

  // 最大页码：以页面真实分页控件为唯一依据（当前页无链接但显示数字也要计入）
  // 返回 { max, evidence }：evidence 表示是否真的找到分页控件，用于区分“只有一页”和“没有解析到分页”
  parsePagination(doc) {
    let anchors = doc.querySelectorAll("a");
    let spans = doc.querySelectorAll("span");
    let markers = [];
    for (let i = 0; i < anchors.length; i++) markers.push(anchors[i]);
    for (let i = 0; i < spans.length; i++) markers.push(spans[i]);

    let container = null;
    for (let i = 0; i < markers.length; i++) {
      let t = markers[i].text.trim();
      if (t === "下一页" || t === "上一页") {
        container = markers[i].parent;
        break;
      }
    }

    let max = 0;
    if (container) {
      let links = container.querySelectorAll("a");
      for (let i = 0; i < links.length; i++) {
        let n = this.pageNumberFrom(links[i]);
        if (n > max) max = n;
      }
    }
    let evidence = max > 0;
    if (max === 0) {
      for (let i = 0; i < anchors.length; i++) {
        let n = this.pageNumberFrom(anchors[i]);
        if (n > max) max = n;
      }
    }
    return { max: max, evidence: evidence };
  }

  pageNumberFrom(el) {
    let value = 0;
    let text = el.text.trim();
    if (/^\d+$/.test(text)) value = parseInt(text, 10);
    let href = el.attributes["href"] || "";
    let m = String(href).match(/^(\d+)\.html$/);
    if (m) {
      let n = parseInt(m[1], 10);
      if (n > value) value = n;
    }
    if (value > 100000) return 0;
    return value;
  }

  listUrl(param, page) {
    let base = this.siteUrl + "/manhua/" + param + "/";
    if (page > 1) return base + page + ".html";
    return base;
  }

  parseListPage(doc) {
    let comics = [];
    let seen = {};
    let items = doc.querySelectorAll('a[href^="/manhua/detail/"]');
    for (let i = 0; i < items.length; i++) {
      let li = items[i].parent;
      while (li && li.localName !== "li") li = li.parent;
      if (!li) continue;
      let comic = this.parseListItem(li);
      if (!comic) continue;
      if (seen[comic.id]) continue;
      seen[comic.id] = true;
      comics.push(comic);
    }
    return comics;
  }

  /* ------------------------------------------------------------------ */
  /* 首页                                                                */
  /* ------------------------------------------------------------------ */

  explore = [
    {
      title: "动漫啦",
      type: "multiPartPage",
      load: async (page) => {
        let parts = [];

        let homeDoc = null;
        try {
          homeDoc = await this.fetchText(this.siteUrl + "/");
        } catch (e) {
          homeDoc = null;
        }
        if (homeDoc) {
          let doc = new HtmlDocument(homeDoc.body);
          try {
            let sections = doc.querySelectorAll("section.library-section");
            for (let i = 0; i < sections.length; i++) {
              let section = sections[i];
              let head = section.querySelector(".section-heading h2");
              let cards = section.querySelectorAll(".comic-card");
              if (!head || cards.length === 0) continue;
              let title = head.text.trim();
              if (!title) continue;
              let comics = [];
              for (let j = 0; j < cards.length; j++) {
                let comic = this.parseGridCard(cards[j]);
                if (comic) comics.push(comic);
              }
              if (comics.length > 0) parts.push({ title: title, comics: comics });
            }
          } finally {
            doc.dispose();
          }
        }

        let serial = await this.loadListPart("最近更新", "serial");
        if (serial) parts.push(serial);
        let finish = await this.loadListPart("已完结", "finish");
        if (finish) parts.push(finish);

        if (parts.length === 0) {
          throw "首页加载失败：没有解析到任何推荐区块";
        }
        return parts;
      },
      loadNext(next) {},
    },
  ];

  async loadListPart(title, param) {
    try {
      let url = this.listUrl(param, 1);
      let comics = await this.withDocument(url, (doc) => this.parseListPage(doc));
      if (comics.length === 0) return null;
      return { title: title, comics: comics };
    } catch (e) {
      console.warn("分区加载失败 " + title + ": " + e.toString());
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 分类                                                                */
  /* ------------------------------------------------------------------ */

  category = {
    title: "动漫啦",
    parts: [
      {
        name: "题材",
        type: "fixed",
        itemType: "category",
        categories: [
          "少年热血",
          "少女爱情",
          "武侠格斗",
          "科幻魔法",
          "侦探悬疑",
          "幽默搞笑",
          "恐怖灵异",
          "竞技体育",
          "耽美百合",
          "其他漫画",
        ],
        categoryParams: [
          "node/2",
          "node/3",
          "node/4",
          "node/8",
          "node/6",
          "node/7",
          "node/1",
          "node/5",
          "node/10",
          "node/9",
        ],
      },
      {
        name: "地区",
        type: "fixed",
        itemType: "category",
        categories: ["日本", "港台", "欧美", "国产", "韩漫"],
        categoryParams: ["japan", "hongkongtaiwan", "oumei", "guochan", "hanguo"],
      },
      {
        name: "状态",
        type: "fixed",
        itemType: "category",
        categories: ["连载中", "已完结"],
        categoryParams: ["serial", "finish"],
      },
      {
        name: "标签",
        type: "fixed",
        itemType: "category",
        categories: [
          "恋爱",
          "校园",
          "热血",
          "冒险",
          "搞笑",
          "后宫",
          "奇幻",
          "魔法",
          "格斗",
          "竞技",
          "悬疑",
          "恐怖",
          "科幻",
          "历史",
          "战争",
          "治愈",
          "美食",
          "侦探",
          "职场",
          "音乐舞蹈",
          "百合",
          "耽美",
          "伪娘",
          "萌系",
          "四格",
          "颜艺",
          "少女",
          "少年",
          "青年",
          "都市",
          "穿越",
          "异能",
          "古风",
          "短篇",
          "同人",
          "美漫",
          "漫威",
          "轻小说",
          "生活",
          "脑洞",
          "欢乐向",
          "魔幻",
          "玄幻",
          "神鬼",
        ],
        categoryParams: [
          "class/99",
          "class/18",
          "class/32",
          "class/14",
          "class/25",
          "class/33",
          "class/21",
          "class/22",
          "class/16",
          "class/17",
          "class/20",
          "class/19",
          "class/13",
          "class/29",
          "class/30",
          "class/42",
          "class/35",
          "class/46",
          "class/45",
          "class/52",
          "class/38",
          "class/27",
          "class/26",
          "class/37",
          "class/36",
          "class/44",
          "class/43",
          "class/49",
          "class/48",
          "class/105",
          "class/117",
          "class/115",
          "class/114",
          "class/111",
          "class/110",
          "class/106",
          "class/2156",
          "class/98",
          "class/82",
          "class/81",
          "class/108",
          "class/34",
          "class/12",
          "class/23",
        ],
      },
    ],
    enableRankingPage: false,
  };

  /* ------------------------------------------------------------------ */
  /* 分类列表                                                            */
  /* ------------------------------------------------------------------ */

  categoryComics = {
    load: async (category, param, options, page) => {
      let p = param == null ? "" : String(param).trim();
      p = p.replace(/^\/+/, "").replace(/\/+$/, "");
      if (!this.isValidCategoryParam(p)) {
        return { comics: [], maxPage: page > 0 ? page : 1 };
      }
      let url = this.listUrl(p, page);
      let parsed = await this.withDocument(url, (doc) => {
        return {
          comics: this.parseListPage(doc),
          pagination: this.parsePagination(doc),
        };
      });
      if (parsed.comics.length === 0 && page > 1) {
        // 超出真实页码：有分页证据时用页面页码，否则只退回到上一页，不伪造大页码
        let fallback = parsed.pagination.evidence ? parsed.pagination.max : page - 1;
        if (fallback < 1) fallback = 1;
        return { comics: [], maxPage: fallback };
      }
      let maxPage = parsed.pagination.max;
      if (maxPage < page) maxPage = page;
      if (maxPage < 1) maxPage = 1;
      return { comics: parsed.comics, maxPage: maxPage };
    },
  };

  isValidCategoryParam(param) {
    if (/^(node|class)\/\d+$/.test(param)) return true;
    if (/^(japan|hongkongtaiwan|oumei|guochan|hanguo|serial|finish)$/.test(param)) return true;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* 搜索                                                                */
  /* ------------------------------------------------------------------ */

  search = {
    load: async (keyword, options, page) => {
      let word = keyword == null ? "" : String(keyword).trim();
      if (word.length === 0) {
        return { comics: [], maxPage: 1 };
      }
      let encoded = encodeURIComponent(word);
      // 表单 action 为 /manhua/search/，真实请求经 302 落到 /manhua/so/{关键词}/，直接请求最终路由
      let url = this.siteUrl + "/manhua/so/" + encoded + "/";
      if (page > 1) url = url + page + ".html";
      let parsed = await this.withDocument(url, (doc) => {
        return {
          comics: this.parseListPage(doc),
          pagination: this.parsePagination(doc),
        };
      });
      if (parsed.comics.length === 0) {
        return { comics: [], maxPage: 1 };
      }
      let maxPage = parsed.pagination.max;
      if (maxPage < page) maxPage = page;
      if (maxPage < 1) maxPage = 1;
      return { comics: parsed.comics, maxPage: maxPage };
    },
  };

  /* ------------------------------------------------------------------ */
  /* 详情                                                                */
  /* ------------------------------------------------------------------ */

  comic = {
    loadInfo: async (id) => {
      let comicId = this.digitsOnly(id);
      if (!comicId) throw "漫画 ID 无效";

      let url = this.siteUrl + "/manhua/detail/" + comicId + "/";
      return await this.withDocument(url, (doc) => {
        let titleEl = doc.querySelector('h1[itemprop="name"]');
        if (!titleEl || !titleEl.text.trim()) {
          throw "Comic not found: " + comicId;
        }
        let title = titleEl.text.trim();

        let coverEl = doc.querySelector('img[itemprop="image"]');
        let cover = "";
        if (coverEl) {
          cover = coverEl.attributes["src"] || coverEl.attributes["data-src"] || "";
        }
        cover = this.absoluteUrl(cover);

        let descEl = doc.querySelector('p[itemprop="description"]');
        let description = descEl ? descEl.text.trim() : "";

        let statusEl = doc.querySelector(".status-pill");
        let status = statusEl ? statusEl.text.trim() : "";

        let tags = {};
        let authors = [];
        let authorEls = doc.querySelectorAll('a[href^="/manhua/author/"]');
        for (let i = 0; i < authorEls.length; i++) {
          let t = authorEls[i].text.trim();
          if (t && authors.indexOf(t) < 0) authors.push(t);
        }
        if (authors.length > 0) tags["作者"] = authors;

        let themes = [];
        let themeEls = doc.querySelectorAll('a[href^="/manhua/node/"]');
        for (let i = 0; i < themeEls.length; i++) {
          let t = themeEls[i].text.trim();
          if (t && themes.indexOf(t) < 0) themes.push(t);
        }
        if (themes.length > 0) tags["题材"] = themes;

        let topics = [];
        let topicEls = doc.querySelectorAll('.detail-meta a[href^="/manhua/class/"]');
        for (let i = 0; i < topicEls.length; i++) {
          let t = topicEls[i].text.trim();
          if (t && topics.indexOf(t) < 0) topics.push(t);
        }
        if (topics.length > 0) tags["标签"] = topics;

        if (status) tags["状态"] = [status];

        let updateTime = "";
        let metas = doc.querySelectorAll(".detail-meta");
        for (let i = 0; i < metas.length; i++) {
          let t = metas[i].text.trim();
          let m = t.match(/更新于\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
          if (m) {
            updateTime = m[1];
            break;
          }
        }

        let chapters = new Map();
        let chapterRoot = doc.getElementById("chapters");
        let chapterEls = [];
        if (chapterRoot) {
          chapterEls = chapterRoot.querySelectorAll('a[href*="/manhua/chapter/"]');
        }
        if (chapterEls.length === 0) {
          chapterEls = doc.querySelectorAll('a[href*="/manhua/chapter/"]');
        }
        for (let i = 0; i < chapterEls.length; i++) {
          let href = chapterEls[i].attributes["href"] || "";
          let m = String(href).match(/\/manhua\/chapter\/(\d+)\/(\d+)/);
          if (!m) continue;
          if (m[1] !== comicId) continue;
          let epId = m[2];
          let label = chapterEls[i].text.trim();
          if (!label || label.indexOf("开始阅读") >= 0) {
            if (!chapters.has(epId)) chapters.set(epId, "第?话");
            continue;
          }
          if (!chapters.has(epId) || chapters.get(epId) === "第?话") {
            chapters.set(epId, label);
          }
        }

        return new ComicDetails({
          title: title,
          subtitle: authors.join(" / "),
          subTitle: authors.join(" / "),
          cover: cover,
          description: description,
          tags: tags,
          chapters: chapters,
          isFavorite: false,
          subId: comicId,
          thumbnails: cover ? [cover] : [],
          recommend: [],
          updateTime: updateTime,
          url: url,
        });
      });
    },

    onThumbnailLoad: (url) => {
      return {
        headers: {
          "Referer": this.siteUrl + "/",
          "User-Agent": this.userAgent,
        },
      };
    },

    loadEp: async (comicId, epId) => {
      let target = this.normalizeEp(comicId, epId);
      if (!target) {
        return { images: [] };
      }

      let images = [];
      try {
        images = await this.fetchChapterImages(this.chapterUrl(target.comicId, target.epId, true));
      } catch (e) {
        images = [];
      }
      if (images.length === 0) {
        // 整话页不可用时回退到普通阅读页（只含当前页与预加载页，属于站点真实行为）
        try {
          images = await this.fetchChapterImages(this.chapterUrl(target.comicId, target.epId, false));
          console.warn("整话页无图，已回退普通页: " + target.comicId + "/" + target.epId + " 共 " + images.length + " 张");
        } catch (e) {
          images = [];
        }
      }
      return { images: images };
    },

    onImageLoad: (url, comicId, epId) => {
      let target = this.normalizeEp(comicId, epId);
      let referer = this.siteUrl + "/";
      if (target) {
        referer = this.chapterUrl(target.comicId, target.epId, false);
      }
      return {
        headers: {
          "Referer": referer,
          "User-Agent": this.userAgent,
        },
      };
    },

    idMatch: "(?:https?://(?:www\\.)?dongman\\.la/manhua/(?:detail|chapter)/)?(\\d+)",
  };

  chapterUrl(comicId, epId, all) {
    let base = this.siteUrl + "/manhua/chapter/" + comicId + "/" + epId + "/";
    if (all) return base + "all.html";
    return base;
  }

  // 历史入参标准化：纯章节 ID / comicId|epId / 完整章节 URL / 对象参数
  normalizeEp(comicId, epId) {
    let raw = epId;
    if (raw !== null && typeof raw === "object") {
      if (raw.epId !== undefined && raw.epId !== null) {
        raw = raw.epId;
      } else if (raw.chapterId !== undefined && raw.chapterId !== null) {
        raw = raw.chapterId;
      } else if (raw.id !== undefined && raw.id !== null) {
        raw = raw.id;
      } else if (raw.url !== undefined && raw.url !== null) {
        raw = raw.url;
      } else {
        return null;
      }
    }

    if (raw === null || raw === undefined) return null;
    let text = String(raw).trim();
    if (text.length === 0) return null;
    if (text.indexOf("%") >= 0) {
      try {
        text = decodeURIComponent(text);
      } catch (e) {
        // 解码失败时保留原值，后续正则校验会安全失败
      }
    }

    let outerComic = this.digitsOnly(comicId);

    // 完整 URL 或含路径
    let m = text.match(/\/manhua\/chapter\/(\d+)\/(\d+)/);
    if (m) {
      if (outerComic && outerComic !== m[1]) return null;
      return { comicId: m[1], epId: m[2] };
    }

    // 组合 ID：comicId|epId、comicId,epId、comicId/epId
    let parts = text.split(/[|,\/\s]+/).filter((s) => s.length > 0);
    if (parts.length === 2) {
      if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
      if (outerComic && outerComic !== parts[0]) return null;
      return { comicId: parts[0], epId: parts[1] };
    }

    // 纯章节 ID
    if (parts.length === 1 && /^\d+$/.test(parts[0])) {
      if (!outerComic) return null;
      return { comicId: outerComic, epId: parts[0] };
    }

    return null;
  }

  async fetchChapterImages(url) {
    return await this.withDocument(url, (doc) => {
      let images = [];
      let imgs = doc.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) {
        let alt = imgs[i].attributes["alt"] || "";
        let cls = imgs[i].classNames ? imgs[i].classNames.join(" ") : "";
        let isPage = /第\d+(\.\d+)?[页話话]/.test(alt) || cls.indexOf("reader-img") >= 0 || alt === "preload";
        if (!isPage) continue;
        let src = imgs[i].attributes["data-src"] || imgs[i].attributes["src"] || "";
        if (!src) continue;
        let full = this.absoluteUrl(src);
        if (!full) continue;
        if (images.indexOf(full) < 0) images.push(full);
      }
      return images;
    });
  }
}
