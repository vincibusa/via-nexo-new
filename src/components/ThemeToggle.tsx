"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Laptop } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const cycle = () => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Laptop;
  return (
    <Button variant="ghost" size="icon" onClick={cycle} aria-label="Toggle theme">
      <Icon className="h-5 w-5" />
    </Button>
  );
}
