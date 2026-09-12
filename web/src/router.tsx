import { createBrowserRouter, createHashRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ComfyUiLocalPage from "@/pages/comfyui-local";
import ConfigPage from "@/pages/config";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import { isTauriRuntime } from "@/services/platform/desktop-runtime";

const createAppRouter = isTauriRuntime() ? createHashRouter : createBrowserRouter;

export const router = createAppRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <CanvasPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/comfyui-local", element: <ComfyUiLocalPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
