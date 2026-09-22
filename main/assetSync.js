import { lib, game, ui, get, ai, _status } from "noname";

/**
 * 联机素材同步
 *
 * 本扩展的武将图放在扩展目录（extension/星之梦/image/character/）里，没装本扩展的客机取不到这些文件，
 * 只能显示默认剪影。这里在联机开局广播（precontent 里 postReconnect 的那次 broadcast）时把该目录下的
 * 图片一并发给客机，客机收到后把指向扩展素材的图片路径换成同步过来的图片，
 * 这样单向联机时客机也能正常显示这些武将的形象。
 *
 * 只同步本目录下的文件，子文件夹（如 dcloutou）里的内容不处理。
 */

/** 需要同步的素材目录（相对游戏根目录） */
const assetDirectory = "extension/星之梦/image/character/";
/** 图片单边超过该像素时等比缩小 */
const assetMaxSize = 512;
/** 图片压缩质量 */
const assetQuality = 0.9;
/** data URL 短于该长度时不压缩，直接发原图 */
const assetCompressThreshold = 120000;

/** 收集状态：0 未开始 / 1 收集中 / 2 已完成 */
let assetState = 0;
/** 收集重试次数 */
let assetRetry = 0;
/** 收集超时计时器 */
let assetTimer = null;

/**
 * 客机侧：接收主机同步过来的武将图。
 *
 * 注意：本函数会被序列化后发送到客机执行（见 `_status.postReconnect`），
 * 函数体内只能使用 `lib`、`game` 等全局变量，不能引用本文件作用域里的任何变量。
 */
function receiveCharacterAssets(assets) {
	//本机自己就装了本扩展，直接用本地素材
	if (!assets || lib.extensionPack["星之梦"]) {
		return;
	}
	const map = (lib.lmCharacterAssets = lib.lmCharacterAssets || {});
	for (const name in assets) {
		const data = assets[name];
		if (typeof data == "string" && data.startsWith("data:")) {
			map[name] = data;
		}
	}
	//已经改过渲染接口，更新素材表就够了
	if (lib.lmCharacterAssetsPatched || !Object.keys(map).length) {
		return;
	}
	if (typeof HTMLDivElement == "undefined" || !HTMLDivElement.prototype) {
		return;
	}
	//客机上并没有扩展目录，这里把指向扩展素材的图片路径换成同步过来的图片
	const fragment = "星之梦/image/character/";
	const toName = src => {
		if (typeof src != "string") {
			return null;
		}
		let str = src,
			index = str.indexOf(fragment);
		//路径可能被编码过（%E6%98%9F...）
		if (index == -1 && str.includes("%")) {
			try {
				str = decodeURIComponent(str);
			} catch (e) {
				return null;
			}
			index = str.indexOf(fragment);
		}
		if (index == -1) {
			return null;
		}
		let name = str.slice(index + fragment.length);
		//子文件夹（如 dcloutou）里的素材不同步
		if (name.includes("/")) {
			return null;
		}
		const query = name.indexOf("?");
		if (query != -1) {
			name = name.slice(0, query);
		}
		const dot = name.lastIndexOf(".");
		return dot > 0 ? name.slice(0, dot) : name;
	};
	const convert = value => {
		if (typeof value != "string") {
			return value;
		}
		const name = toName(value);
		return name && map[name] ? map[name] : value;
	};
	const origin = HTMLDivElement.prototype.setBackgroundImage;
	HTMLDivElement.prototype.setBackgroundImage = function (img) {
		if (Array.isArray(img)) {
			//数组形式下本体实现会给每一项前面加上 lib.assetURL，data 链接会被加上前缀而失效，所以这里单独处理
			this.style.backgroundImage = img
				.map(convert)
				.unique()
				.map(value => `url("${typeof value == "string" && value.startsWith("data:") ? "" : lib.assetURL}${value}")`)
				.join(",");
			return this;
		}
		return origin.call(this, convert(img));
	};
	lib.lmCharacterAssetsPatched = true;
}

/**
 * 压缩 data URL，压不小或压缩失败时返回原图。
 * @param { string } dataUrl
 * @param { (dataUrl: string) => void } callback
 */
function compressCharacterAsset(dataUrl, callback) {
	if (typeof document == "undefined" || dataUrl.length <= assetCompressThreshold) {
		callback(dataUrl);
		return;
	}
	const image = new Image();
	image.onload = () => {
		let result = dataUrl;
		try {
			const width = image.naturalWidth || image.width,
				height = image.naturalHeight || image.height;
			if (!width || !height) {
				throw new Error("无法读取尺寸");
			}
			const scale = Math.min(1, assetMaxSize / Math.max(width, height));
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(width * scale));
			canvas.height = Math.max(1, Math.round(height * scale));
			canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
			let compressed = canvas.toDataURL("image/webp", assetQuality);
			if (!compressed.startsWith("data:image/webp")) {
				//不支持编码webp的环境退回jpg
				compressed = canvas.toDataURL("image/jpeg", assetQuality);
			}
			if (compressed && compressed.length < dataUrl.length) {
				result = compressed;
			}
		} catch (e) {
			result = dataUrl;
		}
		callback(result);
	};
	image.onerror = () => callback(dataUrl);
	image.src = dataUrl;
}

/**
 * 读取一张素材图片，转成 data URL（必要时压缩）后交给回调。
 * @param { string } file
 * @param { (dataUrl: string) => void } callback
 */
function readCharacterAsset(file, callback) {
	const path = assetDirectory + file;
	let url;
	try {
		url = lib.init.parseResourceAddress(path);
	} catch (e) {
		console.warn(`『星之梦』解析联机素材路径失败：${path}`, e);
		return;
	}
	get.blobFromUrl(url)
		.then(blob => get.dataUrlAsync(blob))
		.then(dataUrl => compressCharacterAsset(dataUrl.href, callback))
		.catch(e => console.warn(`『星之梦』读取联机素材失败：${path}`, e));
}

/**
 * 把武将图挂到 `_status.postReconnect` 上，联机开局时会随其它数据一起广播给客机，
 * 同时开始读取图片（异步，越早调用越好，避免开局时还没读完）。
 */
export function syncCharacterAssets() {
	if (!_status.postReconnect.lm_characterAssets) {
		_status.postReconnect.lm_characterAssets = [receiveCharacterAssets, {}];
	}
	if (assetState || typeof game.getFileList != "function") {
		return;
	}
	assetState = 1;
	//读取卡住时的看门狗
	assetTimer = setTimeout(() => {
		assetTimer = null;
		if (assetState == 1) {
			retryCollect();
		}
	}, 15000);
	game.getFileList(
		assetDirectory,
		(folders, files) => {
			const assets = _status.postReconnect.lm_characterAssets[1];
			//只处理尚未读到的文件，重试时不会重复读取
			const list = (files || []).filter(file => /\.(?:jpg|jpeg|png|webp|gif|bmp)$/i.test(file)).filter(file => !assets[file.slice(0, file.lastIndexOf("."))]);
			if (!list.length) {
				finishCollect();
				return;
			}
			let rest = list.length;
			for (const file of list) {
				readCharacterAsset(file, dataUrl => {
					assets[file.slice(0, file.lastIndexOf("."))] = dataUrl;
					if (--rest <= 0) {
						finishCollect();
					}
				});
			}
		},
		() => {
			retryCollect();
		}
	);
}

/** 收集完成 */
function finishCollect() {
	assetState = 2;
	clearTimeout(assetTimer);
	assetTimer = null;
}

/** 有文件没读到（或读取卡住）时重试 */
function retryCollect() {
	clearTimeout(assetTimer);
	assetTimer = null;
	if (assetRetry >= 3) {
		assetState = 2;
		return;
	}
	assetRetry++;
	assetState = 0;
	setTimeout(syncCharacterAssets, 1000);
}
