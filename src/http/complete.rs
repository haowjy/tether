//! `POST /complete` (complete.md "Request and response"): a thin handler that parses
//! the body, takes an in-flight permit and calls `Completer::complete`. It sits in the
//! `devices` router, behind both auth layers. Neither the body nor the chips are
//! logged: they are what Jimmy typed.

use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, State};
use axum::response::{IntoResponse as _, Response};
use axum::routing::post;
use axum::{Json, Router};

use super::{Ctx, Refusal};
use crate::proto::HttpError;
use crate::proto::complete::{CompleteRequest, Completion};

/// Larger bodies get `413`.
const BODY: usize = 4 * 1024;
/// More at once get `503 busy` at once: the next keystroke asks again.
pub(super) const IN_FLIGHT: usize = 4;

pub(super) fn routes() -> Router<Arc<Ctx>> {
    Router::new().route(
        "/complete",
        post(complete).layer(DefaultBodyLimit::max(BODY)),
    )
}

async fn complete(
    State(ctx): State<Arc<Ctx>>,
    body: Result<Json<CompleteRequest>, JsonRejection>,
) -> Response {
    let Some(completer) = ctx.complete.as_ref() else {
        return Json(Completion { chips: Vec::new() }).into_response();
    };
    let request = match body {
        Ok(Json(request)) => request,
        Err(rejection) => return Refusal::from(rejection).into_response(),
    };
    let cwd_ok = request
        .cwd
        .as_deref()
        .is_none_or(|cwd| crate::fs::check_shape(cwd).is_ok());
    if !cwd_ok {
        return Refusal::from(HttpError::BadRequest).into_response();
    }
    let Ok(_permit) = ctx.completing.clone().try_acquire_owned() else {
        return Refusal::from(HttpError::Busy).into_response();
    };
    Json(completer.complete(request).await).into_response()
}
