//! The two routes that skip the device check (auth.md "Enrolment"): `GET /auth/info`
//! and `POST /auth/enroll`. Both sit behind the Tailscale check.

use std::sync::Arc;
use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse as _, Response};
use tracing::{error, info, warn};

use super::{Ctx, Login, refusal};
use crate::auth::store::EnrollError;
use crate::proto::auth::{AuthInfo, EnrollRequest, EnrollResponse, ProtocolRange};
use crate::proto::{MIN_PROTOCOL, PROTOCOL_VERSION};

pub(super) async fn info(State(ctx): State<Arc<Ctx>>) -> Json<AuthInfo> {
    Json(AuthInfo {
        host_id: ctx.app.host.id.clone(),
        name: ctx.app.host.name.clone(),
        daemon_version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol: ProtocolRange {
            min: MIN_PROTOCOL,
            max: PROTOCOL_VERSION,
        },
    })
}

/// Checks the code under the state file's lock, off the runtime. `Json` refuses any
/// body that isn't `application/json`, so a page can't post one without a CORS
/// preflight, which the daemon never answers.
pub(super) async fn enroll(
    State(ctx): State<Arc<Ctx>>,
    Extension(Login(login)): Extension<Login>,
    body: Result<Json<EnrollRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match body {
        Ok(body) => body,
        Err(rejection) => return refusal(rejection.status(), "bad_request"),
    };
    let store = ctx.app.auth.store().clone();
    let by = login.clone();
    let enrolled = tokio::task::spawn_blocking(move || {
        store.enroll(&request.code, &request.device_name, &by, SystemTime::now())
    })
    .await;
    match enrolled {
        Ok(Ok(added)) => {
            info!(device = %added.name, by = %login, "enrolled a device");
            let response = EnrollResponse {
                token: added.token,
                device_name: added.name,
            };
            Json(response).into_response()
        }
        Ok(Err(EnrollError::BadCode)) => {
            warn!(by = %login, "refused an enrolment code");
            refusal(StatusCode::FORBIDDEN, "bad_code")
        }
        Ok(Err(EnrollError::Store(cause))) => {
            error!(%cause, "can't enrol a device");
            refusal(StatusCode::INTERNAL_SERVER_ERROR, "internal")
        }
        Err(cause) => {
            error!(%cause, "the enrolment task failed");
            refusal(StatusCode::INTERNAL_SERVER_ERROR, "internal")
        }
    }
}
