import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// RootLayout renders this tag; persistTheme writes into it.
document.head.append(
  Object.assign(document.createElement("meta"), { name: "theme-color" }),
);
