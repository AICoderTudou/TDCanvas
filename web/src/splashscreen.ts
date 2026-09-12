import { invoke } from "@tauri-apps/api/core";

import { installNativeContextMenuGuard } from "@/lib/native-context-menu";
import "./styles/splashscreen.css";

installNativeContextMenuGuard();

type Point = { x: number; y: number };

type SeedNode = {
    angle: number;
    delay: number;
    duration: number;
    inner: boolean;
    phase: number;
    radius: number;
    start: Point;
    target: Point;
    x: number;
    y: number;
};

const ANIMATION_COMPLETE_AT = 2_200;
const REDUCED_MOTION_COMPLETE_AT = 360;
const NODE_COUNT = 32;
const OUTLINE_NODE_COUNT = 24;
const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
    [24, 1],
    [24, 7],
    [25, 5],
    [25, 13],
    [26, 10],
    [27, 15],
];
const TRAIL_NODE_INDICES = [0, 5, 11, 18, 27] as const;

document.documentElement.classList.add("splash-animated");

const canvas = document.querySelector<HTMLCanvasElement>("#particle-field");
const coreElement = document.querySelector<HTMLElement>("#particle-core");
const brandElement = document.querySelector<HTMLElement>("#startup-brand");

let completionReported = false;

function reportAnimationComplete() {
    if (completionReported) return;
    completionReported = true;
    document.documentElement.classList.add("splash-complete");
    void invoke("splash_animation_complete").catch(() => undefined);
}

if (!canvas || !coreElement || !brandElement) {
    window.setTimeout(reportAnimationComplete, REDUCED_MOTION_COMPLETE_AT);
} else {
    const particleCanvas = canvas;
    const particleCore = coreElement;
    const startupBrand = brandElement;
    const context = particleCanvas.getContext("2d", { alpha: true })!;

    if (!context) {
        window.setTimeout(reportAnimationComplete, REDUCED_MOTION_COMPLETE_AT);
    } else {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const forcedColors = window.matchMedia("(forced-colors: active)").matches;
        const nodes: SeedNode[] = [];
        const purpleGlow = createGlowSprite([139, 121, 255]);
        const goldGlow = createGlowSprite([224, 174, 88]);

        let width = 0;
        let height = 0;
        let pixelRatio = 1;
        let coreX = 0;
        let coreY = 0;
        let brandX = 0;
        let brandY = 0;
        let animationFrame = 0;
        let startedAt = 0;
        let lastRenderedAt = 0;
        let slowFrameCount = 0;
        let activeFrameInterval = 1000 / 60;

        function clamp(value: number, minimum = 0, maximum = 1) {
            return Math.min(maximum, Math.max(minimum, value));
        }

        function easeOutCubic(value: number) {
            return 1 - Math.pow(1 - clamp(value), 3);
        }

        function easeInOutCubic(value: number) {
            const point = clamp(value);
            return point < 0.5 ? 4 * point * point * point : 1 - Math.pow(-2 * point + 2, 3) / 2;
        }

        function createRandom(seed: number) {
            let state = seed >>> 0;
            return () => {
                state += 0x6d2b79f5;
                let value = state;
                value = Math.imul(value ^ (value >>> 15), value | 1);
                value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
                return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
            };
        }

        function createGlowSprite([red, green, blue]: [number, number, number]) {
            const sprite = document.createElement("canvas");
            const size = 32;
            sprite.width = size;
            sprite.height = size;
            const spriteContext = sprite.getContext("2d");
            if (!spriteContext) return sprite;
            const gradient = spriteContext.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            gradient.addColorStop(0, "rgba(255, 255, 255, 0.98)");
            gradient.addColorStop(0.16, `rgba(${red}, ${green}, ${blue}, 0.9)`);
            gradient.addColorStop(0.45, `rgba(${red}, ${green}, ${blue}, 0.26)`);
            gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
            spriteContext.fillStyle = gradient;
            spriteContext.fillRect(0, 0, size, size);
            return sprite;
        }

        function cubicPoint(start: Point, firstControl: Point, secondControl: Point, end: Point, progress: number): Point {
            const inverse = 1 - progress;
            const a = inverse * inverse * inverse;
            const b = 3 * inverse * inverse * progress;
            const c = 3 * inverse * progress * progress;
            const d = progress * progress * progress;
            return {
                x: a * start.x + b * firstControl.x + c * secondControl.x + d * end.x,
                y: a * start.y + b * firstControl.y + c * secondControl.y + d * end.y,
            };
        }

        function drawGlow(sprite: HTMLCanvasElement, x: number, y: number, size: number, opacity: number) {
            context.save();
            context.globalAlpha = opacity;
            context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
            context.restore();
        }

        function measureAnchors() {
            const coreBounds = particleCore.getBoundingClientRect();
            const brandBounds = startupBrand.getBoundingClientRect();
            coreX = coreBounds.left + coreBounds.width / 2;
            coreY = coreBounds.top + coreBounds.height / 2;
            brandX = brandBounds.left - 9;
            brandY = brandBounds.top + brandBounds.height / 2;
        }

        function buildNodes() {
            const random = createRandom(20260824);
            const streamOffsets = [-62, 1, 62] as const;
            nodes.length = 0;

            for (let index = 0; index < NODE_COUNT; index += 1) {
                const inner = index >= OUTLINE_NODE_COUNT;
                const angle = inner ? index * 2.399963229728653 : (index / OUTLINE_NODE_COUNT) * Math.PI * 2 - Math.PI / 2;
                const radius = inner ? 0.2 + Math.sqrt(random()) * 0.68 : 1;
                const contour = inner ? 1 : 1 + Math.sin(angle * 3 + 0.7) * 0.065 + Math.cos(angle * 2) * 0.025;
                const target = {
                    x: coreX + Math.cos(angle) * 49 * radius * contour,
                    y: coreY + Math.sin(angle) * 61 * radius * contour,
                };
                const stream = index % streamOffsets.length;
                const start = {
                    x: Math.max(18, coreX - 175 - random() * 95),
                    y: coreY + streamOffsets[stream] + (random() - 0.5) * 34,
                };

                nodes.push({
                    angle,
                    delay: 85 + random() * 310,
                    duration: 700 + random() * 230,
                    inner,
                    phase: random() * Math.PI * 2,
                    radius: inner ? 0.72 + random() * 0.52 : 0.88 + random() * 0.55,
                    start,
                    target,
                    x: start.x,
                    y: start.y,
                });
            }
        }

        function resize() {
            const bounds = particleCanvas.getBoundingClientRect();
            width = Math.max(1, bounds.width);
            height = Math.max(1, bounds.height);
            pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
            particleCanvas.width = Math.round(width * pixelRatio);
            particleCanvas.height = Math.round(height * pixelRatio);
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            measureAnchors();
            buildNodes();
        }

        function getNodePosition(node: SeedNode, elapsed: number) {
            const progress = easeInOutCubic((elapsed - node.delay) / node.duration);
            const settledTime = Math.max(0, elapsed - 1_480);
            const end = {
                x: node.target.x + Math.sin(settledTime * 0.001 + node.phase) * (node.inner ? 1.2 : 0.75),
                y: node.target.y + Math.cos(settledTime * 0.00086 + node.phase) * (node.inner ? 0.8 : 1),
            };
            const firstControl = {
                x: node.start.x + 64 + Math.cos(node.angle) * 18,
                y: node.start.y - 46 + Math.sin(node.angle * 1.4) * 30,
            };
            const secondControl = {
                x: coreX - 74,
                y: coreY + Math.cos(node.angle * 1.7) * 72,
            };
            return {
                point: cubicPoint(node.start, firstControl, secondControl, end, progress),
                progress,
            };
        }

        function updateNodes(elapsed: number) {
            for (const node of nodes) {
                const next = getNodePosition(node, elapsed);
                node.x = next.point.x;
                node.y = next.point.y;
            }
        }

        function strokeConnection(from: Point, to: Point, strength: number) {
            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.strokeStyle = `rgba(4, 5, 8, ${0.24 * strength})`;
            context.lineWidth = 1.7;
            context.stroke();

            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.strokeStyle = `rgba(151, 136, 255, ${0.4 * strength})`;
            context.lineWidth = 0.68;
            context.stroke();
        }

        function drawConnections(elapsed: number) {
            const strength = easeOutCubic((elapsed - 690) / 610);
            if (strength <= 0) return;
            for (const [fromIndex, toIndex] of CONNECTIONS) {
                strokeConnection(nodes[fromIndex], nodes[toIndex], strength);
            }
        }

        function drawTravelTrails(elapsed: number) {
            for (const [order, nodeIndex] of TRAIL_NODE_INDICES.entries()) {
                const node = nodes[nodeIndex];
                const current = getNodePosition(node, elapsed);
                const previous = getNodePosition(node, Math.max(0, elapsed - 72));
                const fade = 1 - clamp((elapsed - 1_330 - order * 32) / 210);
                if (current.progress <= 0 || fade <= 0) continue;

                context.beginPath();
                context.moveTo(previous.point.x, previous.point.y);
                context.lineTo(current.point.x, current.point.y);
                context.strokeStyle = `rgba(4, 5, 8, ${0.26 * fade})`;
                context.lineWidth = 2.2;
                context.stroke();

                const gradient = context.createLinearGradient(previous.point.x, previous.point.y, current.point.x, current.point.y);
                gradient.addColorStop(0, "rgba(139, 121, 255, 0)");
                gradient.addColorStop(1, `rgba(185, 175, 255, ${0.78 * fade})`);
                context.beginPath();
                context.moveTo(previous.point.x, previous.point.y);
                context.lineTo(current.point.x, current.point.y);
                context.strokeStyle = gradient;
                context.lineWidth = 0.95;
                context.stroke();
                drawGlow(order === 0 ? goldGlow : purpleGlow, current.point.x, current.point.y, order === 0 ? 17 : 12, 0.72 * fade);
            }
        }

        function drawNodes(elapsed: number) {
            nodes.forEach((node, index) => {
                const reveal = clamp((elapsed - node.delay) / 210);
                if (reveal <= 0) return;

                context.beginPath();
                context.arc(node.x, node.y, node.radius + 1.15, 0, Math.PI * 2);
                context.fillStyle = `rgba(4, 5, 8, ${0.2 * reveal})`;
                context.fill();

                context.beginPath();
                context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                context.fillStyle = index === 0
                    ? `rgba(224, 174, 88, ${0.95 * reveal})`
                    : node.inner
                        ? `rgba(235, 232, 255, ${0.78 * reveal})`
                        : `rgba(164, 149, 255, ${0.9 * reveal})`;
                context.fill();
            });
        }

        function drawOrbitArcs(elapsed: number) {
            const strength = easeOutCubic((elapsed - 520) / 620);
            if (strength <= 0) return;
            const rotation = elapsed * 0.00034;
            const arcs = [
                { radiusX: 70, radiusY: 48, tilt: -0.48, start: -0.7 + rotation, length: 1.22, alpha: 0.48 },
            ];

            for (const arc of arcs) {
                context.beginPath();
                context.ellipse(coreX, coreY, arc.radiusX, arc.radiusY, arc.tilt, arc.start, arc.start + arc.length);
                context.strokeStyle = `rgba(4, 5, 8, ${0.22 * strength})`;
                context.lineWidth = 1.7;
                context.stroke();

                context.beginPath();
                context.ellipse(coreX, coreY, arc.radiusX, arc.radiusY, arc.tilt, arc.start, arc.start + arc.length);
                context.strokeStyle = `rgba(167, 153, 255, ${arc.alpha * strength})`;
                context.lineWidth = 0.7;
                context.stroke();
            }
        }

        function drawBridgePath(progress: number, color: string, lineWidth: number) {
            const start = { x: coreX + 43, y: coreY - 2 };
            const firstControl = { x: coreX + 76, y: coreY - 34 };
            const secondControl = { x: brandX - 38, y: brandY + 20 };
            const end = { x: brandX, y: brandY };
            const segments = 30;

            context.beginPath();
            context.moveTo(start.x, start.y);
            let lastPoint = start;
            for (let index = 1; index <= Math.max(1, Math.ceil(segments * progress)); index += 1) {
                const pointProgress = Math.min(progress, index / segments);
                lastPoint = cubicPoint(start, firstControl, secondControl, end, pointProgress);
                context.lineTo(lastPoint.x, lastPoint.y);
            }
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
            return lastPoint;
        }

        function drawBrandBridge(elapsed: number) {
            const progress = easeInOutCubic((elapsed - 880) / 530);
            if (progress <= 0) return;
            const retainedAlpha = progress < 1 ? 1 : 0.46;
            drawBridgePath(progress, `rgba(4, 5, 8, ${0.28 * retainedAlpha})`, 1.9);
            const spark = drawBridgePath(progress, `rgba(164, 149, 255, ${0.62 * retainedAlpha})`, 0.72);
            const sparkFade = 1 - clamp((elapsed - 1_460) / 240);
            if (sparkFade > 0) drawGlow(purpleGlow, spark.x, spark.y, 17, 0.86 * sparkFade);
        }

        function drawActivationWaves(elapsed: number) {
            const waves = [
                { start: 1_430, duration: 470, maximum: 83, alpha: 0.28 },
                { start: 1_610, duration: 560, maximum: 99, alpha: 0.2 },
            ];
            for (const wave of waves) {
                const progress = clamp((elapsed - wave.start) / wave.duration);
                if (progress <= 0 || progress >= 1) continue;
                const radius = 20 + easeOutCubic(progress) * wave.maximum;
                context.beginPath();
                context.ellipse(coreX, coreY, radius, radius * 0.78, -0.18, 0, Math.PI * 2);
                context.strokeStyle = `rgba(4, 5, 8, ${(1 - progress) * 0.18})`;
                context.lineWidth = 1.7;
                context.stroke();
                context.beginPath();
                context.ellipse(coreX, coreY, radius, radius * 0.78, -0.18, 0, Math.PI * 2);
                context.strokeStyle = `rgba(159, 144, 255, ${(1 - progress) * wave.alpha})`;
                context.lineWidth = 0.65;
                context.stroke();
            }
        }

        function drawCoreLight(elapsed: number) {
            const reveal = easeOutCubic((elapsed - 190) / 510);
            if (reveal <= 0) return;
            drawGlow(goldGlow, coreX, coreY, 25, 0.62 * reveal);
            drawGlow(purpleGlow, coreX, coreY, 42, 0.28 * reveal);
        }

        function drawScene(elapsed: number) {
            context.clearRect(0, 0, width, height);
            updateNodes(elapsed);
            drawConnections(elapsed);
            drawOrbitArcs(elapsed);
            drawTravelTrails(elapsed);
            drawBrandBridge(elapsed);
            drawNodes(elapsed);
            drawCoreLight(elapsed);
            drawActivationWaves(elapsed);
        }

        function render(timestamp: number) {
            if (!startedAt) startedAt = timestamp;
            const elapsed = Math.max(0, timestamp - startedAt);
            const delta = timestamp - lastRenderedAt;

            if (lastRenderedAt && delta > 24) {
                slowFrameCount += 1;
                if (slowFrameCount >= 8) activeFrameInterval = 1000 / 30;
            } else {
                slowFrameCount = Math.max(0, slowFrameCount - 1);
            }

            if (!lastRenderedAt || delta >= activeFrameInterval) {
                drawScene(Math.min(elapsed, ANIMATION_COMPLETE_AT));
                lastRenderedAt = timestamp;
            }

            if (elapsed >= ANIMATION_COMPLETE_AT) {
                reportAnimationComplete();
                return;
            }
            animationFrame = window.requestAnimationFrame(render);
        }

        function handleVisibilityChange() {
            if (document.hidden) {
                window.cancelAnimationFrame(animationFrame);
                return;
            }
            animationFrame = window.requestAnimationFrame(render);
        }

        function handleResize() {
            resize();
            if (reduceMotion || forcedColors || completionReported) {
                drawScene(ANIMATION_COMPLETE_AT);
            }
        }

        window.addEventListener("resize", handleResize, { passive: true });
        document.addEventListener("visibilitychange", handleVisibilityChange);

        resize();
        if (reduceMotion || forcedColors) {
            drawScene(ANIMATION_COMPLETE_AT);
            window.setTimeout(reportAnimationComplete, REDUCED_MOTION_COMPLETE_AT);
        } else {
            animationFrame = window.requestAnimationFrame((timestamp) => {
                drawScene(0);
                startedAt = timestamp;
                animationFrame = window.requestAnimationFrame(render);
            });
        }
    }
}
