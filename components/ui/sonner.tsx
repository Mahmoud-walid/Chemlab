"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import type { ToasterProps as SonnerToastProps } from "sonner";

// Define position types locally
export type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

// Custom Toast type
interface CustomToastProps extends Omit<
  SonnerToastProps,
  "title" | "description"
> {
  title?: string;
  description?: string;
  customButton?: React.ReactNode;
  position?: ToastPosition;
}

const Toaster = ({
  position = "top-right",
  ...props
}: SonnerToastProps & { position?: ToastPosition }) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as SonnerToastProps["theme"]}
      className="toaster group"
      position={position} // supports top-right, top-left, bottom-right, bottom-left
      duration={5000} // 5 seconds auto-close
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

// Helper functions for global toast calls
const toast = {
  success: ({
    title = "title",
    description = "description",
    customButton,
    position,
    ...props
  }: CustomToastProps) => {
    sonnerToast.success(
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-bold">{title}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>

        {customButton && <div className="mt-2">{customButton}</div>}
      </div>,
      {
        duration: 5000,
        position,
        ...props,
      },
    );
  },

  error: ({
    title = "title",
    description = "description",
    customButton,
    position,
    ...props
  }: CustomToastProps) => {
    sonnerToast.error(
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-bold">{title}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>

        {customButton && <div className="mt-2">{customButton}</div>}
      </div>,
      {
        duration: 5000,
        position,
        ...props,
      },
    );
  },
};

export { Toaster, toast };
