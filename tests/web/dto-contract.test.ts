import { describe, expect, expectTypeOf, it } from "vitest";

import {
  PRODUCT_API_GET_ROUTES,
  PRODUCT_API_MUTATION_ROUTES,
  type CoachDto,
  type HistoryPageDto,
  type ProgressDto,
  type ProductApiGetMap,
  type ProductApiMutationMap,
  type SettingsDto,
  type SubmitActivityResponse,
  type TimezoneUpdateResponse,
  type TodayDto,
  type TrainingDto,
} from "../../src/product-api/dto.js";
import type { Band8Runtime } from "../../src/runtime/runtime.js";
import type { ProductGetHandlers, ProductMutationHandlers } from "../../src/server/server.js";
import { getJson, postJson } from "../../web/src/api.js";

describe("closed learner-visible Product API contract", () => {
  it("publishes one finite GET and mutation route map shared by Runtime and browser", () => {
    if (false) {
      expectTypeOf<(typeof PRODUCT_API_GET_ROUTES)[number]>().toEqualTypeOf<keyof ProductApiGetMap>();
      expectTypeOf<(typeof PRODUCT_API_MUTATION_ROUTES)[number]>().toEqualTypeOf<keyof ProductApiMutationMap>();
    }
    expect(PRODUCT_API_GET_ROUTES).toEqual([
      "/api/v1/today",
      "/api/v1/training",
      "/api/v1/progress",
      "/api/v1/history",
      "/api/v1/coach",
      "/api/v1/settings",
    ]);
    expect(PRODUCT_API_MUTATION_ROUTES).toEqual([
      "/api/v1/timezone",
      "/api/v1/packages/import",
      "/api/v1/sessions/start",
      "/api/v1/training/complete",
      "/api/v1/coach/export",
      "/api/v1/coach/import",
    ]);
  });

  it("keeps every learner-visible page represented by a closed named DTO", () => {
    const dtoNames: Array<TodayDto | TrainingDto | ProgressDto | HistoryPageDto | CoachDto | SettingsDto> = [];
    expect(dtoNames).toEqual([]);
  });

  it("maps route literals to their exact response DTO at compile time", () => {
    if (false) {
      expectTypeOf(getJson("/api/v1/today")).toEqualTypeOf<Promise<TodayDto>>();
      expectTypeOf(getJson("/api/v1/training")).toEqualTypeOf<Promise<TrainingDto | null>>();
      expectTypeOf(getJson("/api/v1/progress")).toEqualTypeOf<Promise<ProgressDto>>();
      expectTypeOf(getJson("/api/v1/history?limit=20")).toEqualTypeOf<Promise<HistoryPageDto>>();
      expectTypeOf(getJson("/api/v1/coach")).toEqualTypeOf<Promise<CoachDto>>();
      expectTypeOf(getJson("/api/v1/settings")).toEqualTypeOf<Promise<SettingsDto>>();
      expectTypeOf(postJson("/api/v1/timezone", { operation: "configure", timeZone: "Asia/Shanghai" }))
        .toEqualTypeOf<Promise<TimezoneUpdateResponse>>();
    }
    expect(true).toBe(true);
  });

  it("binds Runtime product projections to the same closed DTOs", () => {
    if (false) {
      const runtime = null as unknown as Band8Runtime;
      expectTypeOf(runtime.today()).toEqualTypeOf<TodayDto>();
      expectTypeOf(runtime.training()).toEqualTypeOf<TrainingDto | null>();
      expectTypeOf(runtime.progress()).toEqualTypeOf<ProgressDto>();
      expectTypeOf(runtime.history()).toEqualTypeOf<HistoryPageDto>();
      expectTypeOf(runtime.coachStatus()).toEqualTypeOf<CoachDto>();
      expectTypeOf(runtime.workspaceInformation()).toEqualTypeOf<SettingsDto>();
      expectTypeOf(runtime.submitCurrentActivity("session-one")).toEqualTypeOf<SubmitActivityResponse>();
    }
    expect(true).toBe(true);
  });

  it("requires the HTTP adapter handler tables to cover the shared route maps exactly", () => {
    if (false) {
      expectTypeOf<keyof ProductGetHandlers>().toEqualTypeOf<keyof ProductApiGetMap>();
      expectTypeOf<keyof ProductMutationHandlers>().toEqualTypeOf<keyof ProductApiMutationMap>();
    }
    expect(true).toBe(true);
  });
});
