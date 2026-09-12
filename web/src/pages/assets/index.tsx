import { Check, Copy, Download, Images, Package, PencilLine, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { downloadBlobBackedMedia } from "@/services/media-download";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { downloadAssetsZip, exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = ["all", "text", "image", "video"] as const;

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const projects = useCanvasStore((state) => state.projects);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
    const [batchDownloading, setBatchDownloading] = useState(false);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);
    const recentCanvasTitle = useMemo(() => [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.title || "TDCanvas", [projects]);
    const selectedAssets = useMemo(() => validAssets.filter((asset) => selectedAssetIds.has(asset.id)), [selectedAssetIds, validAssets]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: t("assets.manual"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error(t("assets.selectImage"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? t("assets.updated") : t("assets.saved"));
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = async (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        const key = `asset-download-${asset.id}`;
        message.open({ key, type: "loading", content: t("assets.downloading"), duration: 0 });
        try {
            await downloadBlobBackedMedia({
                kind: asset.kind,
                url: asset.kind === "video" ? asset.data.url : asset.data.dataUrl || asset.coverUrl,
                storageKey: asset.data.storageKey,
                filename: asset.title,
                mimeType: asset.data.mimeType,
            });
            message.success({ key, content: t("assets.downloaded") });
        } catch (error) {
            message.error({ key, content: t("assets.downloadFailed", { message: error instanceof Error ? error.message : String(error) }), duration: 4 });
        }
    };

    const downloadSelectedAssets = async () => {
        if (!selectedAssets.length || batchDownloading) return;
        setBatchDownloading(true);
        const projectTitles = Array.from(new Set(selectedAssets.map((asset) => (typeof asset.metadata?.projectTitle === "string" ? asset.metadata.projectTitle.trim() : "")).filter(Boolean)));
        const canvasTitle = projectTitles.length === 1 ? projectTitles[0]! : recentCanvasTitle;
        const key = "asset-batch-download";
        message.open({ key, type: "loading", content: t("assets.batchPreparing", { count: selectedAssets.length }), duration: 0 });
        try {
            const result = await downloadAssetsZip(selectedAssets, canvasTitle);
            message.success({ key, content: result.skipped ? t("assets.batchDownloadedPartial", result) : t("assets.batchDownloaded", result), duration: 4 });
            setSelectionMode(false);
            setSelectedAssetIds(new Set());
        } catch (error) {
            message.error({ key, content: t("assets.downloadFailed", { message: error instanceof Error ? error.message : String(error) }), duration: 4 });
        } finally {
            setBatchDownloading(false);
        }
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        await exportAssets(validAssets, t("assets.packageName"));
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(t("assets.imported", { count: importedAssets.length }));
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success(t("assets.deleted"));
        setDeletingAsset(null);
    };

    return (
        <>
            <WorkspacePage
                icon={Images}
                title={t("assets.title")}
                description={t("assets.description")}
                meta={`${filteredAssets.length} / ${validAssets.length}`}
                actions={
                    <>
                        {selectionMode ? (
                            <>
                                <span className="px-1 text-[11px] text-stone-500 dark:text-zinc-400">{t("assets.selected", { count: selectedAssetIds.size })}</span>
                                <button type="button" className="td-workspace-action" onClick={() => setSelectedAssetIds(new Set(filteredAssets.map((asset) => asset.id)))}><Check className="size-3.5" />{t("assets.selectAll")}</button>
                                <button type="button" className="td-workspace-action is-primary disabled:cursor-not-allowed disabled:opacity-40" disabled={!selectedAssetIds.size || batchDownloading} onClick={() => void downloadSelectedAssets()}><Download className="size-3.5" />{t("assets.downloadZip")}</button>
                                <button type="button" className="td-workspace-action" onClick={() => { setSelectionMode(false); setSelectedAssetIds(new Set()); }}><X className="size-3.5" />{t("common.cancel")}</button>
                            </>
                        ) : (
                            <>
                                <button type="button" className="td-workspace-action" onClick={() => setSelectionMode(true)}><Package className="size-3.5" />{t("assets.batchDownload")}</button>
                                <button type="button" className="td-workspace-action" onClick={() => void exportAllAssets()}><Download className="size-3.5" />{t("assets.export")}</button>
                                <button type="button" className="td-workspace-action" onClick={() => assetInputRef.current?.click()}><Upload className="size-3.5" />{t("assets.import")}</button>
                                <button type="button" className="td-workspace-action is-primary" onClick={openCreate}><Plus className="size-3.5" />{t("assets.add")}</button>
                            </>
                        )}
                    </>
                }
            >
                <div className="td-workspace-toolbar sticky top-0 z-10 flex min-h-14 flex-col gap-2 rounded-[15px] border border-black/[0.07] bg-background/90 p-2 backdrop-blur-xl dark:border-white/[0.07] sm:flex-row sm:items-center">
                    <Input
                        allowClear
                        prefix={<Search className="size-4 text-stone-400" />}
                        value={keyword}
                        placeholder={t("assets.search")}
                        className="td-workspace-search min-w-0 flex-1"
                        onChange={(event) => {
                            setPage(1);
                            setKeyword(event.target.value);
                        }}
                    />
                    <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
                        {kindOptions.map((option) => (
                            <button
                                key={option}
                                type="button"
                                className={`h-8 shrink-0 cursor-pointer rounded-[9px] px-3 text-[11px] transition ${kindFilter === option ? "bg-black/[0.07] font-medium text-stone-950 dark:bg-white/[0.09] dark:text-white" : "text-stone-500 hover:bg-black/[0.035] hover:text-stone-900 dark:text-zinc-500 dark:hover:bg-white/[0.045] dark:hover:text-zinc-200"}`}
                                onClick={() => {
                                    setPage(1);
                                    setKindFilter(option);
                                }}
                            >
                                {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mt-6 flex flex-col gap-6">
                    <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {visibleAssets.map((asset) => (
                            <AssetCard
                                key={asset.id}
                                asset={asset}
                                selectionMode={selectionMode}
                                selected={selectedAssetIds.has(asset.id)}
                                onToggleSelected={() => setSelectedAssetIds((current) => { const next = new Set(current); if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id); return next; })}
                                onOpen={() => setPreviewAsset(asset)}
                                onEdit={() => openEdit(asset)}
                                onCopy={copyAssetText}
                                onDownload={(target) => void downloadImage(target)}
                                onDelete={() => setDeletingAsset(asset)}
                            />
                        ))}
                    </div>

                    {!visibleAssets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-20" /> : null}

                    <div className="flex min-h-10 justify-center">
                        <Pagination
                            current={page}
                            pageSize={pageSize}
                            total={filteredAssets.length}
                            showSizeChanger
                            pageSizeOptions={[10, 20, 50, 100]}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    </div>
                </div>
            </WorkspacePage>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select
                                options={[
                                    { label: t("assets.kinds.text"), value: "text" },
                                    { label: t("assets.kinds.image"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, message: t("assets.fields.titleRequired") }]}>
                            <Input size="large" placeholder={t("assets.fields.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.fields.tagsPlaceholder")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, message: t("assets.fields.textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("assets.fields.imageContent")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets.selectImageFile")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.noImageSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("assets.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets.untagged")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={(asset) => void downloadImage(asset)} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("assets.deleteConfirm", { name: deletingAsset?.title })}
            </Modal>
        </>
    );
}

function AssetCard({ asset, selectionMode, selected, onToggleSelected, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; selectionMode: boolean; selected: boolean; onToggleSelected: () => void; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const summary = assetSummary(asset);
    return (
        <article className={`group relative flex min-w-0 flex-col overflow-hidden rounded-[16px] border bg-black/[0.015] transition duration-200 hover:-translate-y-0.5 dark:bg-white/[0.025] ${selected ? "border-blue-500 ring-2 ring-blue-500/20" : "border-black/[0.08] hover:border-black/[0.17] dark:border-white/[0.08] dark:hover:border-white/[0.17]"}`}>
            {selectionMode ? (
                <button type="button" className={`absolute right-3 top-3 z-10 grid size-7 place-items-center rounded-full border shadow-lg backdrop-blur-xl transition ${selected ? "border-blue-400 bg-blue-500 text-white" : "border-white/20 bg-black/55 text-white/70 hover:bg-black/75"}`} onClick={onToggleSelected} aria-label={selected ? t("assets.unselect") : t("assets.select")}>
                    {selected ? <Check className="size-4" /> : null}
                </button>
            ) : null}
            <button type="button" className="block w-full cursor-pointer overflow-hidden text-left" onClick={selectionMode ? onToggleSelected : onOpen}>
                {cover ? (
                    <img src={cover} alt={asset.title} className="aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.018]" />
                ) : (
                    <div className="flex aspect-[16/10] items-center justify-center bg-black/[0.025] p-5 text-center text-[11px] leading-5 text-stone-500 dark:bg-white/[0.025] dark:text-zinc-500">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                )}
            </button>
            <button type="button" className="block w-full flex-1 cursor-pointer text-left" onClick={selectionMode ? onToggleSelected : onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-[13px] font-semibold tracking-[-0.01em] text-stone-950 dark:text-zinc-100">{asset.title}</h2>
                            <span className="mt-1 block truncate text-[10px] text-stone-400 dark:text-zinc-600">{asset.source || t("assets.unknownSource")}</span>
                        </div>
                        <span className="shrink-0 rounded-full bg-black/[0.045] px-2 py-1 text-[9px] text-stone-500 dark:bg-white/[0.045] dark:text-zinc-500">{t(`assets.kinds.${asset.kind}`)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 min-h-9 text-[11px] leading-[18px] text-stone-500 dark:text-zinc-500">{summary}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {(asset.tags || []).slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-full bg-black/[0.045] px-2 py-1 text-[9px] text-stone-500 dark:bg-white/[0.045] dark:text-zinc-500">{tag}</span>
                        ))}
                        {!asset.tags?.length ? <span className="rounded-full bg-black/[0.045] px-2 py-1 text-[9px] text-stone-400 dark:bg-white/[0.045] dark:text-zinc-600">{t("assets.noTags")}</span> : null}
                    </div>
                </div>
            </button>
            <div className={`mt-auto min-h-12 items-center gap-1 overflow-x-auto border-t border-black/[0.06] px-3 dark:border-white/[0.06] ${selectionMode ? "hidden" : "flex"}`}>
                {asset.kind !== "video" ? (
                    <Button type="text" size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>
                        {t("common.edit")}
                    </Button>
                ) : null}
                {asset.kind === "text" ? (
                    <Button type="text" size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>
                        {t("common.copy")}
                    </Button>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" ? (
                    <Button type="text" size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>
                        {t("common.download")}
                    </Button>
                ) : null}
                <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                    {t("common.delete")}
                </Button>
            </div>
        </article>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("assets.details")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <Image src={cover} alt={asset.title} className="rounded-lg" />
                    ) : (
                        <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                        <Typography.Text type="secondary" className="block text-xs">
                            {t("assets.fields.textContent")}
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <Typography.Text type="secondary">{t("assets.fields.note")}</Typography.Text>
                            <Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets.copyText")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? t("assets.downloadVideo") : t("assets.downloadImage")}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
