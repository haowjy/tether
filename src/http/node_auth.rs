//! Node-lane enrolment and removal. The router's node check has already resolved and
//! admitted the request node before these handlers touch `auth.toml`.

use std::sync::Arc;
use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse as _, Response};
use serde::Deserialize;
use tracing::{error, info, warn};

use super::{Ctx, Login, Refusal};
use crate::auth::store::EnrollError;
use crate::auth::{AuthError, Session};
use crate::proto::HttpError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EnrollRequest {
    code: String,
    device_name: String,
}

pub(super) async fn session(Extension(session): Extension<Session>) -> Response {
    let Session::Node { device, .. } = session else {
        return Refusal::from(HttpError::AuthRequired).into_response();
    };
    (
        StatusCode::OK,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({ "deviceName": device.name })),
    )
        .into_response()
}

pub(super) async fn enroll(
    State(ctx): State<Arc<Ctx>>,
    Extension(session): Extension<Session>,
    Extension(Login(login)): Extension<Login>,
    headers: HeaderMap,
    body: Result<Json<EnrollRequest>, JsonRejection>,
) -> Response {
    let (node_id, name, enrolled) = match session {
        Session::Node { node, .. } => (node.id, node.name, true),
        Session::NodeUnenrolled { node, .. } => (node.id, node.name, false),
        Session::Native(_) => return Refusal::from(HttpError::BadRequest).into_response(),
    };
    let Json(request) = match body {
        Ok(body) => body,
        Err(rejection) => return Refusal::from(rejection).into_response(),
    };
    let store = ctx.app.auth.store().clone();
    let requested_name = if request.device_name.trim().is_empty() {
        name.clone()
    } else {
        request.device_name
    };
    if request.code.is_empty() {
        if ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]
            .iter()
            .any(|header| headers.contains_key(*header))
        {
            warn!(by = %login, "refused a native token mint with browser fetch metadata");
            return Refusal::from(HttpError::BadOrigin).into_response();
        }
        if !enrolled {
            return Refusal::from(&AuthError::NotEnrolled { node_name: name }).into_response();
        }
        let by = login.clone();
        return match ctx
            .app
            .lanes
            .auth
            .run(move || {
                store.add_native_for_node(&requested_name, &node_id, &by, SystemTime::now())
            })
            .await
        {
            Ok(Ok(Some(added))) => {
                info!(device = %added.name, by = %login, "minted a native token for an enrolled node");
                (
                    StatusCode::OK,
                    [(axum::http::header::CACHE_CONTROL, "no-store")],
                    Json(serde_json::json!({
                        "token": added.token,
                        "deviceName": added.name
                    })),
                )
                    .into_response()
            }
            Ok(Ok(None)) => {
                Refusal::from(&AuthError::NotEnrolled { node_name: name }).into_response()
            }
            Ok(Err(cause)) => {
                error!(%cause, "can't mint a native token for a node");
                Refusal::from(HttpError::Internal).into_response()
            }
            Err(_) => Refusal::from(HttpError::Busy).into_response(),
        };
    }
    let by = login.clone();
    let enrolled = ctx
        .app
        .lanes
        .auth
        .run(move || {
            store.enroll_node(
                &request.code,
                &requested_name,
                &node_id,
                &by,
                &by,
                SystemTime::now(),
            )
        })
        .await;
    match enrolled {
        Ok(Ok(device_name)) => {
            info!(device = %device_name, by = %login, "enrolled a node");
            (
                StatusCode::OK,
                [(axum::http::header::CACHE_CONTROL, "no-store")],
                Json(serde_json::json!({ "deviceName": device_name })),
            )
                .into_response()
        }
        Ok(Err(EnrollError::BadCode)) => {
            warn!(by = %login, "refused a node enrolment code");
            Refusal::from(HttpError::BadCode).into_response()
        }
        Ok(Err(EnrollError::Store(cause))) => {
            error!(%cause, "can't enrol a node");
            Refusal::from(HttpError::Internal).into_response()
        }
        Err(_) => Refusal::from(HttpError::Busy).into_response(),
    }
}

pub(super) async fn remove(
    State(ctx): State<Arc<Ctx>>,
    Extension(session): Extension<Session>,
) -> Response {
    let node_id = match session {
        Session::Node { node, .. } | Session::NodeUnenrolled { node, .. } => node.id,
        Session::Native(_) => return Refusal::from(HttpError::BadRequest).into_response(),
    };
    let store = ctx.app.auth.store().clone();
    match ctx
        .app
        .lanes
        .auth
        .run(move || store.remove_node(&node_id))
        .await
    {
        Ok(Ok(_)) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(cause)) => {
            error!(%cause, "can't remove a node");
            Refusal::from(HttpError::Internal).into_response()
        }
        Err(_) => Refusal::from(HttpError::Busy).into_response(),
    }
}
