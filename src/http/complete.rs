//! `POST /complete` (complete.md "Request and response"): a thin handler that parses
//! the body, takes an in-flight permit and calls `Completer::complete`. It sits in the
//! `devices` router, behind both auth layers. Neither the body nor the chips are
//! logged: they are what Jimmy typed.

use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse as _, Response};
use axum::routing::post;
use axum::{Json, Router};

use super::{Ctx, refusal};
use crate::proto::complete::CompleteRequest;

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
    let request = match body {
        Ok(Json(request)) => request,
        Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return refusal(rejection.status(), "too_large");
        }
        Err(rejection) => return refusal(rejection.status(), "bad_request"),
    };
    let cwd_ok = request
        .cwd
        .as_deref()
        .is_none_or(|cwd| crate::fs::check_shape(cwd).is_ok());
    if !cwd_ok {
        return refusal(StatusCode::BAD_REQUEST, "bad_request");
    }
    let Ok(_permit) = ctx.completing.clone().try_acquire_owned() else {
        let mut busy = refusal(StatusCode::SERVICE_UNAVAILABLE, "busy");
        let retry = HeaderValue::from_static("1");
        busy.headers_mut().insert(header::RETRY_AFTER, retry);
        return busy;
    };
    Json(ctx.complete.complete(request).await).into_response()
}
