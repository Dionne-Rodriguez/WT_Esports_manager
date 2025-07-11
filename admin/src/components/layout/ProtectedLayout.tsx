// src/components/layout/ProtectedLayout.tsx
import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar.tsx";
import { AppSidebar } from "@/components/app-sidebar.tsx";

export default function ProtectedLayout() {
    const navigate = useNavigate();
    const token = localStorage.getItem("token");

    // redirect to /login if not authenticated
    useEffect(() => {
        if (!token) navigate("/login", { replace: true });
    }, [token]);

    if (!token) {
        // while redirecting, don’t flash the sidebar
        return null;
    }

    return (
        <SidebarProvider
            style={{
                "--sidebar-width": "calc(var(--spacing) * 72)",
                "--header-height": "calc(var(--spacing) * 12)",
            } as React.CSSProperties}
        >
            <AppSidebar variant="inset" />
            <SidebarInset>
                <Outlet />
            </SidebarInset>
        </SidebarProvider>
    );
}
