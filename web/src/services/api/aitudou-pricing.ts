import { isTauriRuntime, platformFetch } from "@/services/platform/desktop-runtime";

export const AITUDOU_PRICING_URL = "https://api.aitudou.net/api/pricing";
export const AITUDOU_PRICING_PROXY_URL = "/tdtv-api/aitudou/api/pricing";

export type AitudouPriceStatus = "exact" | "range" | "rate" | "dynamic" | "unknown";
export type AitudouPriceUnit = "task" | "image" | "track" | "second" | "million_tokens" | "audio_minute";

export type AitudouObservedPriceEntry = {
    params: Record<string, unknown>;
    priceCny: number;
    lowCny: number;
    highCny: number;
    lastSeenAt: number;
    sampleCount?: number;
    confidence?: string;
};

export type AitudouObservedPrice = {
    entries: AitudouObservedPriceEntry[];
    priceMin: number;
    priceMax: number;
    activeFeatures: string[];
    sampleCount?: number;
    status?: string;
};

export type AitudouPricingCatalog = {
    pricingVersion: string;
    observedPrices: Record<string, AitudouObservedPrice>;
    priceEstimates: Record<string, AitudouObservedPrice>;
};

export type AitudouPricingContext = {
    imageReferences?: number;
    videoReferences?: number;
    audioReferences?: number;
};

export type AitudouPriceQuote = {
    status: AitudouPriceStatus;
    source: "estimate" | "observed" | "docs" | "none";
    sku: string;
    unit: AitudouPriceUnit;
    amount?: number;
    min?: number;
    max?: number;
    fixedAmount?: number;
    currency?: "CNY" | "TOKENS";
    approximate?: boolean;
    explanation: string;
    observedAt?: number;
    pricingVersion?: string;
};

let cachedCatalog: AitudouPricingCatalog | null = null;
let catalogRequest: Promise<AitudouPricingCatalog> | null = null;
let cachedCatalogAt = 0;

const AITUDOU_PRICING_CACHE_TTL_MS = 5 * 60 * 1000;

export function getCachedAitudouPricingCatalog() {
    return cachedCatalog;
}

export async function loadAitudouPricingCatalog(force = false): Promise<AitudouPricingCatalog> {
    if (!force && cachedCatalog && Date.now() - cachedCatalogAt < AITUDOU_PRICING_CACHE_TTL_MS) return cachedCatalog;
    if (!force && catalogRequest) return catalogRequest;

    catalogRequest = platformFetch(resolveAitudouPricingUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
    })
        .then(async (response) => {
            if (!response.ok) throw new Error(`Aitudou pricing request failed: HTTP ${response.status}`);
            return parseAitudouPricingCatalog(await response.json());
        })
        .then((catalog) => {
            cachedCatalog = catalog;
            cachedCatalogAt = Date.now();
            return catalog;
        })
        .finally(() => {
            catalogRequest = null;
        });

    return catalogRequest;
}

export function resetAitudouPricingCacheForTest() {
    cachedCatalog = null;
    cachedCatalogAt = 0;
    catalogRequest = null;
}

export function resolveAitudouPricingUrl() {
    return typeof window === "undefined" || isTauriRuntime() ? AITUDOU_PRICING_URL : AITUDOU_PRICING_PROXY_URL;
}

export function parseAitudouPricingCatalog(raw: unknown): AitudouPricingCatalog {
    if (!isRecord(raw)) throw new Error("Invalid Aitudou pricing response");
    const pricingVersion = typeof raw.pricing_version === "string" ? raw.pricing_version : "";
    const observedPrices = parseHistoricalPrices(raw.observed_prices, false);
    const priceEstimates = parseHistoricalPrices(raw.price_estimates, true);
    return { pricingVersion, observedPrices, priceEstimates };
}

function parseHistoricalPrices(raw: unknown, estimates: boolean): Record<string, AitudouObservedPrice> {
    const source = isRecord(raw) ? raw : {};
    const result: Record<string, AitudouObservedPrice> = {};

    for (const [sku, value] of Object.entries(source)) {
        if (!isRecord(value) || !Array.isArray(value.entries)) continue;
        const entries = value.entries.flatMap<AitudouObservedPriceEntry>((entry) => {
            if (!isRecord(entry)) return [];
            const priceCny = finitePositive(entry.price_cny);
            if (priceCny === null) return [];
            const rawLow = estimates ? finitePositive(entry.low_cny) : null;
            const rawHigh = estimates ? finitePositive(entry.high_cny) : null;
            const lowCny = Math.min(priceCny, rawLow ?? priceCny, rawHigh ?? priceCny);
            const highCny = Math.max(priceCny, rawLow ?? priceCny, rawHigh ?? priceCny);
            const sampleCount = finiteNonNegative(entry.sample_count);
            return [
                {
                    params: isRecord(entry.params) ? entry.params : {},
                    priceCny,
                    lowCny,
                    highCny,
                    lastSeenAt: finiteNumber(entry.last_seen_at) ?? 0,
                    ...(sampleCount !== null ? { sampleCount } : {}),
                    ...(typeof entry.confidence === "string" && entry.confidence.trim() ? { confidence: entry.confidence.trim().toLowerCase() } : {}),
                },
            ];
        });
        if (!entries.length) continue;
        const derivedMin = Math.min(...entries.map((entry) => entry.lowCny));
        const derivedMax = Math.max(...entries.map((entry) => entry.highCny));
        const priceMin = finitePositive(value.price_min) ?? derivedMin;
        const priceMax = finitePositive(value.price_max) ?? derivedMax;
        const sampleCount = finiteNonNegative(value.sample_count);
        result[sku] = {
            entries,
            priceMin: Math.min(priceMin, priceMax, derivedMin),
            priceMax: Math.max(priceMin, priceMax, derivedMax),
            activeFeatures: Array.isArray(value.active_features) ? value.active_features.filter((feature): feature is string => typeof feature === "string").map(canonicalFeatureName) : [],
            ...(sampleCount !== null ? { sampleCount } : {}),
            ...(typeof value.status === "string" ? { status: value.status } : {}),
        };
    }

    return result;
}

function canonicalFeatureName(feature: string) {
    return ({ n: "output_count", batch_size: "output_count", repeat: "output_count", seconds: "duration_seconds", duration: "duration_seconds" } as Record<string, string>)[feature] || feature;
}

export function resolveAitudouPricingSku(operationId: string, payload: Record<string, unknown>): string {
    if (operationId === "midjourney.video" && String(payload.video_type || "").includes("720")) return "midjourney-video-720p";
    if (operationId.startsWith("midjourney.")) return `midjourney-${operationId.slice("midjourney.".length)}`;
    if (operationId.startsWith("suno.")) {
        const action = operationId.slice("suno.".length);
        return `suno-${action === "generate" ? "generation" : action}`;
    }
    if (operationId === "video.upscale") return "aitudou-upscaler";
    if (operationId === "audio.transcribe") return "whisper-1";
    if (typeof payload.model === "string" && payload.model.trim()) return payload.model.trim();
    if (operationId === "text.chat") return "kimi-k3";
    return operationId;
}

export function quoteAitudouPrice(catalog: AitudouPricingCatalog | null | undefined, operationId: string, payload: Record<string, unknown>, context: AitudouPricingContext = {}): AitudouPriceQuote {
    const sku = resolveAitudouPricingSku(operationId, payload);
    const estimate = catalog?.priceEstimates[sku];
    let exactEstimate: AitudouPriceQuote | null = null;
    if (estimate?.status === "ready") {
        const quote = quoteHistoricalPrice("estimate", sku, estimate, catalog!.pricingVersion, payload, context, operationId);
        if (quote?.status === "range" || (quote && !isSeedanceSku(sku))) return quote;
        exactEstimate = quote;
    }
    const observed = catalog?.observedPrices[sku];
    if (observed && isSeedanceSku(sku)) {
        const range = quoteSeedanceHistoricalRange(sku, observed, catalog!.pricingVersion, payload, context);
        if (range) return range;
    }
    if (exactEstimate) return exactEstimate;
    if (observed) {
        const quote = quoteHistoricalPrice("observed", sku, observed, catalog!.pricingVersion, payload, context, operationId);
        if (quote) return quote;
    }
    return quoteDocumentedPrice(sku, operationId, payload, context);
}

export function formatAitudouPriceQuote(quote: AitudouPriceQuote, placement: "menu" | "cta" = "cta") {
    if (quote.currency === "TOKENS" || quote.unit === "million_tokens") return "按实际结算";
    const suffix = placement === "menu" ? unitSuffix(quote.unit) : "";
    if (quote.status === "exact" && quote.amount !== undefined) return `${quote.approximate ? "约 " : ""}${formatCurrency(quote.amount, quote.currency)}${suffix}`;
    if (quote.status === "range" && quote.min !== undefined && quote.max !== undefined) {
        return `${quote.approximate ? "约 " : ""}${formatCurrency(quote.min, quote.currency)}–${formatBareAmount(quote.max, quote.currency)}${suffix}`;
    }
    if (quote.status === "rate" && quote.amount !== undefined) {
        const fixed = quote.fixedAmount !== undefined ? ` + ${formatCurrency(quote.fixedAmount, quote.currency)}` : "";
        return `${quote.approximate ? "约 " : ""}${formatCurrency(quote.amount, quote.currency)}${unitSuffix(quote.unit)}${fixed}`;
    }
    if (quote.status === "dynamic") return "按实际结算";
    return "价格待确认";
}

function quoteHistoricalPrice(source: "estimate" | "observed", sku: string, profile: AitudouObservedPrice, pricingVersion: string, payload: Record<string, unknown>, context: AitudouPricingContext, operationId: string): AitudouPriceQuote | null {
    const current = pricingParameters(payload, context);
    const candidates = profile.entries
        .map((entry) => {
            const params = pricingParameters(entry.params, {});
            let score = 0;
            let conflict = false;
            for (const [key, expected] of Object.entries(params)) {
                if (!(key in current)) continue;
                if (samePricingValue(current[key], expected)) score += 1;
                else conflict = true;
            }
            return { entry, score, conflict };
        })
        .filter((candidate) => !candidate.conflict);

    if (!candidates.length) return null;

    const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
    let selectedEntries = bestScore > 0 ? candidates.filter((candidate) => candidate.score === bestScore).map((candidate) => candidate.entry) : candidates.map((candidate) => candidate.entry);
    let narrowedByParameters = bestScore > 0;

    const hdUnmodeled = payload.hd === true && !profile.activeFeatures.includes("hd") && !profile.entries.some((entry) => "hd" in pricingParameters(entry.params, {}));
    if (hdUnmodeled) {
        selectedEntries = profile.entries;
        narrowedByParameters = false;
    }

    let min = Math.min(...selectedEntries.map((entry) => entry.lowCny));
    let max = Math.max(...selectedEntries.map((entry) => entry.highCny));
    const quantity = requestedQuantity(operationId, payload);
    const entriesIncludeQuantity = selectedEntries.some((entry) => "output_count" in pricingParameters(entry.params, {}));
    const profileModelsQuantity = profile.activeFeatures.includes("output_count") || profile.entries.some((entry) => "output_count" in pricingParameters(entry.params, {}));
    let quantityNote = "";

    if (quantity > 1 && !entriesIncludeQuantity) {
        if (hasDocumentedLinearQuantity(sku, operationId)) {
            min *= quantity;
            max *= quantity;
            quantityNote = ` · 已按官方逐张/逐段规则计入 ${quantity} 份`;
        } else if (operationId === "image.generate" && !profileModelsQuantity) {
            max *= quantity;
            quantityNote = ` · 官方未公开该模型多图数量公式，范围按 1 份历史任务到 ${quantity} 次独立生成估算`;
        }
    }

    const observedAt = Math.max(0, ...selectedEntries.map((entry) => entry.lastSeenAt));
    const sampleCount = selectedEntries.reduce((sum, entry) => sum + (entry.sampleCount || 0), 0) || profile.sampleCount;
    const confidence = lowestConfidence(selectedEntries.map((entry) => entry.confidence));
    const confidenceText = confidence ? `，置信度${confidenceLabel(confidence)}` : "";
    const hdNote = hdUnmodeled ? " · 官方价格数据未单独拆分 HD 加价，因此保守显示该模型历史范围" : "";
    const base = {
        source,
        sku,
        unit: "task" as const,
        currency: "CNY" as const,
        approximate: true,
        observedAt,
        pricingVersion,
        explanation:
            source === "estimate"
                ? `来自 Aitudou 官方价格清单按${sampleCount ? ` ${sampleCount} 次` : ""}已结算任务生成的${narrowedByParameters ? "同参数" : "历史"}估价${confidenceText}${quantityNote}${hdNote}；最终以任务完成后的实扣为准。`
                : `来自 Aitudou 官方价格清单中的近期${narrowedByParameters ? "同参数" : "同模型"}人民币实扣${quantityNote}${hdNote}；最终以任务完成后的实扣为准。`,
    };

    min = roundPrice(min);
    max = roundPrice(max);
    if (nearlyEqual(min, max)) return { ...base, status: "exact", amount: min };
    return { ...base, status: "range", min, max };
}

function quoteSeedanceHistoricalRange(sku: string, profile: AitudouObservedPrice, pricingVersion: string, payload: Record<string, unknown>, context: AitudouPricingContext): AitudouPriceQuote | null {
    if (!profile.entries.length) return null;
    const current = pricingParameters(payload, context);
    const duration = finitePositive(current.duration_seconds);
    const resolution = current.resolution;
    const generateAudio = current.generate_audio;
    const observedAt = Math.max(0, ...profile.entries.map((entry) => entry.lastSeenAt));
    const base = {
        source: "observed" as const,
        sku,
        unit: "task" as const,
        currency: "CNY" as const,
        approximate: true,
        observedAt,
        pricingVersion,
    };

    if (sku.endsWith("-multi") || duration === null) {
        const min = roundPrice(profile.priceMin);
        const max = roundPrice(profile.priceMax);
        const explanation = sku.endsWith("-multi")
            ? "根据该 Seedance 模型自身的近期人民币实扣记录估算。多参考视频还会受输入视频时长影响，因此显示历史结算范围；最终以任务完成后的实扣为准。"
            : "根据该 Seedance 模型自身的近期人民币实扣记录估算；选择生成时长后可进一步缩小范围，最终以任务完成后的实扣为准。";
        if (nearlyEqual(min, max)) return { ...base, status: "exact", amount: min, explanation };
        return { ...base, status: "range", min, max, explanation };
    }

    const timedEntries = profile.entries.flatMap((entry) => {
        const params = pricingParameters(entry.params, {});
        const seconds = finitePositive(params.duration_seconds);
        return seconds === null ? [] : [{ entry, params, seconds }];
    });
    if (!timedEntries.length) return null;

    let comparable = timedEntries;
    if (resolution !== undefined) {
        const sameResolution = comparable.filter((candidate) => candidate.params.resolution !== undefined && samePricingValue(candidate.params.resolution, resolution));
        if (sameResolution.length >= 2) comparable = sameResolution;
    }
    if (generateAudio !== undefined) {
        const sameAudioMode = comparable.filter((candidate) => candidate.params.generate_audio !== undefined && samePricingValue(candidate.params.generate_audio, generateAudio));
        if (sameAudioMode.length >= 2) comparable = sameAudioMode;
    }

    const min = roundPrice(Math.min(...comparable.map(({ entry, seconds }) => (entry.lowCny / seconds) * duration)));
    const max = roundPrice(Math.max(...comparable.map(({ entry, seconds }) => (entry.highCny / seconds) * duration)));
    const scope = comparable.length === timedEntries.length ? "同模型" : "同模型、同分辨率/音频模式";
    const explanation = `根据该 Seedance ${scope}的 ${comparable.length} 条近期人民币实扣记录，将历史每秒费用折算为当前 ${duration} 秒的预计区间；Token 消耗会随内容变化，最终以任务完成后的实扣为准。`;
    if (nearlyEqual(min, max)) return { ...base, status: "exact", amount: min, explanation };
    return { ...base, status: "range", min, max, explanation };
}

function isSeedanceSku(sku: string) {
    return sku.startsWith("seedance-2.");
}

function quoteDocumentedPrice(sku: string, operationId: string, payload: Record<string, unknown>, context: AitudouPricingContext): AitudouPriceQuote {
    const canonical = pricingParameters(payload, context);
    const resolution = String(canonical.resolution ?? "").toLowerCase();
    const imageReferences = finiteNonNegative(canonical.input_image_count) ?? 0;
    const videoReferences = finiteNonNegative(canonical.input_video_count) ?? 0;
    const seconds = finitePositive(payload.seconds);
    const outputs = requestedQuantity(operationId, payload);
    const docs = (quote: Omit<AitudouPriceQuote, "source" | "sku">): AitudouPriceQuote => ({ ...quote, source: "docs", sku });

    if (sku.startsWith("seedance-2.0-") || sku.startsWith("seedance-2.5-")) {
        const tier = sku.startsWith("seedance-2.5-") ? "standard" : sku.includes("-mini-") ? "mini" : sku.includes("-fast-") ? "fast" : "standard";
        const hasReferenceVideo = sku.endsWith("-multi") && videoReferences > 0;
        const rate =
            tier === "mini"
                ? hasReferenceVideo
                    ? 14
                    : 23
                : tier === "fast"
                  ? hasReferenceVideo
                      ? 22
                      : 37
                  : resolution === "native4k"
                    ? hasReferenceVideo
                        ? 16
                        : 26
                    : ["1080p", "2k", "4k", "native1080p"].includes(resolution)
                      ? hasReferenceVideo
                          ? 31
                          : 51
                      : hasReferenceVideo
                        ? 28
                        : 46;
        const surcharge = ({ "1080p": 0.28, "2k": 0.42, "4k": 0.63 } as Record<string, number>)[resolution];
        return docs({
            status: "dynamic",
            unit: "task",
            currency: "CNY",
            explanation: `官方文档底层按 ¥${rate}/百万 Token 结算${surcharge ? `，另加超分费 ¥${surcharge}/秒` : ""}；当前无法读取近期人民币任务记录，因此不向用户展示无法直接理解的 Token 单价，最终以任务完成后的实扣为准。`,
        });
    }

    const secondRates: Record<string, Record<string, number>> = {
        "happyhorse-1.1": { "720p": 0.69, "1080p": 0.92 },
        "wan-2.7-spicy": { "720p": 0.91, "1080p": 1.4 },
        "aitudou-upscaler": { "720p": 0.14, "1080p": 0.21, "2k": 0.35, "4k": 0.56 },
    };
    const rateKey = sku.startsWith("happyhorse-1.1-") ? "happyhorse-1.1" : sku.startsWith("wan-2.7-spicy-") ? "wan-2.7-spicy" : sku === "aitudou-upscaler" ? sku : "";
    const rateTable = secondRates[rateKey];
    if (rateTable) {
        const rate = rateTable[resolution];
        if (rate !== undefined && seconds !== null && rateKey !== "aitudou-upscaler") {
            return docs({ status: "exact", unit: "task", currency: "CNY", amount: roundPrice(rate * seconds), approximate: true, explanation: `官方文档指导价：¥${rate}/秒 × ${seconds} 秒；最终以任务结算为准。` });
        }
        if (rate !== undefined)
            return docs({
                status: "rate",
                unit: "second",
                currency: "CNY",
                amount: rate,
                approximate: true,
                explanation: rateKey === "aitudou-upscaler" ? "官方文档按输入视频的真实时长计费；输入素材时长未进入请求参数，因此不能提前伪造总价。" : "官方文档按输出视频时长计费；选择时长后才能得到指导总价。",
            });
        const rates = Object.values(rateTable);
        return docs({ status: "range", unit: "second", currency: "CNY", min: Math.min(...rates), max: Math.max(...rates), approximate: true, explanation: "官方文档指导单价范围；具体单价由分辨率决定。" });
    }

    if (sku.startsWith("minimax-h3-ow-")) {
        const matrix: Record<string, Record<string, number>> = sku.endsWith("-fast")
            ? { "480p": { "5": 0.3, "10": 0.5, "15": 1 }, "720p": { "5": 0.6, "10": 1, "15": 2 } }
            : { "480p": { "5": 0.2, "10": 0.5, "15": 1 }, "720p": { "5": 0.5, "10": 1, "15": 2 } };
        const amount = seconds === null ? undefined : matrix[resolution]?.[String(seconds)];
        if (amount !== undefined) return docs({ status: "exact", unit: "task", currency: "CNY", amount, approximate: true, explanation: "官方文档固定零售指导价；动态价格清单可用时以当前人民币观测价为主。" });
        return docs({ status: "range", unit: "task", currency: "CNY", min: 0.2, max: 2, approximate: true, explanation: "官方文档固定零售指导价范围；分辨率、时长和 Fast 档会影响价格。" });
    }

    if (sku === "doubao-seed-audio-1.0") return docs({ status: "rate", unit: "second", currency: "CNY", amount: 0.004, approximate: true, explanation: "官方文档按生成音频的实际输出时长结算，约 ¥0.004/秒。" });
    if (sku === "mureka-v8-bgm" || sku === "mureka-v9-bgm") return docs({ status: "exact", unit: "task", currency: "CNY", amount: 0.34 * outputs, approximate: true, explanation: `官方文档参考价 ¥0.34/条 × ${outputs} 条；最终以任务结算为准。` });
    if (sku === "whisper-1") return docs({ status: "rate", unit: "audio_minute", currency: "TOKENS", amount: 1000, explanation: "官方文档：每分钟音频消耗 1000 Token，未公布固定人民币换算价。" });
    if (sku === "kimi-k3" || operationId === "text.chat") return docs({ status: "dynamic", unit: "million_tokens", currency: "TOKENS", explanation: "按输入与输出 Token 结算；固定人民币单价以官方控制台为准。" });

    const qwenPro = /^qwen-image-3\.0(?:-global)?-pro-(t2i|i2i)$/.exec(sku);
    if (qwenPro) {
        const unitPrice = resolution === "2k" ? 0.45 : 0.23;
        const inputCost = qwenPro[1] === "i2i" ? 0.02 * (imageReferences || 1) : 0;
        return docs({ status: "exact", unit: "task", currency: "CNY", amount: unitPrice * outputs + inputCost, approximate: true, explanation: "官方文档 Qwen Pro 参考价；图像编辑还会按输入参考图计费，最终以上游实扣为准。" });
    }
    const qwenStandard = /^qwen-image-3\.0(?:-global)?-(t2i|i2i)$/.exec(sku);
    if (qwenStandard) {
        const inputCost = qwenStandard[1] === "i2i" ? 0.02 * (imageReferences || 1) : 0;
        return docs({
            status: "exact",
            unit: "task",
            currency: "CNY",
            amount: roundPrice(0.16 * outputs + inputCost),
            approximate: true,
            explanation: `官方文档标准版参考价：输出约 ¥0.16/张${inputCost ? `，输入参考图约 ¥0.02/张` : ""}；当前按 ${outputs} 张估算，最终以上游实扣为准。`,
        });
    }

    if (sku === "seedream-v5-pro-t2i" || sku === "seedream-v5-pro-i2i") {
        if (sku.endsWith("-t2i") && resolution === "2k") return docs({ status: "rate", unit: "image", currency: "CNY", amount: 0.54, approximate: true, explanation: "官方文档公布的 Seedream 实测参考价：2K 文生图约 ¥0.54/张；最终以上游实扣为准。" });
        if (sku.endsWith("-i2i") && resolution === "1k") return docs({ status: "rate", unit: "image", currency: "CNY", amount: 0.27, approximate: true, explanation: "官方文档公布的 Seedream 实测参考价：1K 图生图约 ¥0.27/张；最终以上游实扣为准。" });
        return docs({ status: "range", unit: "image", currency: "CNY", min: 0.27, max: 0.54, approximate: true, explanation: "官方文档只公布了 Seedream 1K 图生图与 2K 文生图的实测参考值，当前仅展示指导范围；最终以上游实扣为准。" });
    }

    if (operationId.startsWith("midjourney.") || operationId.startsWith("suno.")) {
        return docs({ status: "dynamic", unit: "task", currency: "CNY", explanation: "官方文档规定按任务完成后的实际上游消耗结算；提交预扣，成功多退少补，失败退款。" });
    }
    return docs({ status: "dynamic", unit: "task", currency: "CNY", explanation: "该模型按任务参数或上游实际消耗结算；官方价格清单没有可核验的近期金额。" });
}

function pricingParameters(payload: Record<string, unknown>, context: AitudouPricingContext): Record<string, unknown> {
    const flat = flattenRecord(payload);
    const current: Record<string, unknown> = {};
    const aliases: Record<string, string> = {
        "metadata.resolution": "resolution",
        resolution: "resolution",
        "metadata.ratio": "ratio",
        ratio: "ratio",
        aspect_ratio: "ratio",
        "metadata.size": "size",
        size: "size",
        seconds: "duration_seconds",
        duration: "duration_seconds",
        duration_seconds: "duration_seconds",
        "metadata.duration": "duration_seconds",
        "metadata.generate_audio": "generate_audio",
        generate_audio: "generate_audio",
        n: "output_count",
        "metadata.n": "output_count",
        output_count: "output_count",
        batch_size: "output_count",
        repeat: "output_count",
        speed: "speed",
        version: "version",
        video_type: "video_type",
        niji: "niji",
        draft: "draft",
        hd: "hd",
        quality: "quality",
        "metadata.output_format": "output_format",
        output_format: "output_format",
        input_image_count: "input_image_count",
        input_video_count: "input_video_count",
        input_audio_count: "input_audio_count",
        has_audio_input: "has_audio_input",
        has_video_input: "has_video_input",
        voice: "voice",
        "metadata.voice": "voice",
        "$tdcanvas.seedream.resolution": "resolution",
    };
    for (const [path, value] of Object.entries(flat)) {
        const key = aliases[path];
        if (key && value !== undefined && value !== null && value !== "") current[key] = value;
    }
    if (!("resolution" in current)) {
        const width = finitePositive(flat["metadata.width"]);
        const height = finitePositive(flat["metadata.height"]);
        if (width !== null && height !== null) current.resolution = width * height <= 1_500_000 ? "1k" : "2k";
    }
    const payloadImageReferences = referenceCountFromPayload(payload, ["images", "image_urls", "metadata.images"], ["image", "image_url", "metadata.image_url"]);
    const payloadVideoReferences = referenceCountFromPayload(payload, ["videos", "video_urls", "metadata.videos"], ["video", "video_url", "metadata.video_url"]);
    const payloadAudioReferences = referenceCountFromPayload(payload, ["audios", "audio_urls", "metadata.audios"], ["audio", "audio_url", "metadata.audio_url"]);
    const imageReferences = payloadImageReferences ?? context.imageReferences;
    const videoReferences = payloadVideoReferences ?? context.videoReferences;
    const audioReferences = payloadAudioReferences ?? context.audioReferences;
    if (imageReferences !== undefined) current.input_image_count = imageReferences;
    if (videoReferences !== undefined) {
        current.input_video_count = videoReferences;
        current.has_video_input = videoReferences > 0;
    }
    if (audioReferences !== undefined) {
        current.input_audio_count = audioReferences;
        current.has_audio_input = audioReferences > 0;
    }
    return current;
}

function referenceCountFromPayload(payload: Record<string, unknown>, pluralPaths: string[], singularPaths: string[]) {
    for (const path of pluralPaths) {
        const value = readPath(payload, path);
        if (Array.isArray(value)) return value.length;
    }
    for (const path of singularPaths) {
        const value = readPath(payload, path);
        if (typeof value === "string" && value.trim()) return 1;
    }
    return null;
}

function flattenRecord(value: Record<string, unknown>, prefix = ""): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (key === "metadata" && typeof child === "string") {
            try {
                const parsed = JSON.parse(child) as unknown;
                if (isRecord(parsed)) Object.assign(result, flattenRecord(parsed, path));
            } catch {
                // Historical pricing rows may store metadata as a JSON string.
            }
        } else if (isRecord(child)) Object.assign(result, flattenRecord(child, path));
        else result[path] = child;
    }
    return result;
}

function samePricingValue(left: unknown, right: unknown) {
    const normalize = (value: unknown) => {
        if (typeof value === "string") {
            const trimmed = value.trim().toLowerCase();
            if (trimmed === "true") return true;
            if (trimmed === "false") return false;
            if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
            return trimmed;
        }
        return value;
    };
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    if (typeof normalizedLeft === "number" && typeof normalizedRight === "string") {
        const range = parseNumericRange(normalizedRight);
        if (range) return normalizedLeft >= range[0] && normalizedLeft <= range[1];
    }
    if (typeof normalizedRight === "number" && typeof normalizedLeft === "string") {
        const range = parseNumericRange(normalizedLeft);
        if (range) return normalizedRight >= range[0] && normalizedRight <= range[1];
    }
    return normalizedLeft === normalizedRight;
}

function requestedQuantity(operationId: string, payload: Record<string, unknown>) {
    if (operationId === "midjourney.video") return finitePositive(payload.batch_size) ?? 1;
    return finitePositive(payload.n) ?? finitePositive(readPath(payload, "metadata.n")) ?? finitePositive(payload.repeat) ?? 1;
}

function hasDocumentedLinearQuantity(sku: string, operationId: string) {
    return operationId.startsWith("midjourney.") || sku.startsWith("qwen-image-3.0") || sku === "mureka-v8-bgm" || sku === "mureka-v9-bgm";
}

function parseNumericRange(value: string): [number, number] | null {
    const match = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(value.trim());
    if (!match) return null;
    const left = Number(match[1]);
    const right = Number(match[2]);
    return [Math.min(left, right), Math.max(left, right)];
}

function lowestConfidence(values: Array<string | undefined>) {
    const filtered = values.filter((value): value is string => Boolean(value));
    if (!filtered.length) return undefined;
    const ranks: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return filtered.reduce((lowest, value) => ((ranks[value] || 0) < (ranks[lowest] || 0) ? value : lowest));
}

function confidenceLabel(value: string) {
    return ({ high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}

function unitSuffix(unit: AitudouPriceUnit) {
    return { task: "/次", image: "/张", track: "/条", second: "/秒", million_tokens: "/百万Token", audio_minute: "/分钟" }[unit];
}

function formatCurrency(value: number, currency: AitudouPriceQuote["currency"]) {
    if (currency === "TOKENS") return `${formatNumber(value)} Token`;
    return `¥${formatNumber(value)}`;
}

function formatBareAmount(value: number, currency: AitudouPriceQuote["currency"]) {
    return currency === "TOKENS" ? `${formatNumber(value)} Token` : formatNumber(value);
}

function formatNumber(value: number) {
    return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: value < 0.1 ? 3 : 2, maximumFractionDigits: value < 1 ? 3 : 2 }).format(value);
}

function readPath(value: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

function finiteNumber(value: unknown) {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? number : null;
}

function finitePositive(value: unknown) {
    const number = finiteNumber(value);
    return number !== null && number > 0 ? number : null;
}

function finiteNonNegative(value: unknown) {
    const number = finiteNumber(value);
    return number !== null && number >= 0 ? number : null;
}

function nearlyEqual(left: number, right: number) {
    return Math.abs(left - right) < 0.000001;
}

function roundPrice(value: number) {
    return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
