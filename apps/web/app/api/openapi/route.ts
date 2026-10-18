import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/openapi";

export const GET = () => NextResponse.json(openApiDocument);
