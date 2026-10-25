//! Pure browser-node parsing and origin admission rules.

use std::collections::HashSet;
use std::net::IpAddr;
use std::str::FromStr as _;

use axum::http::{HeaderMap, HeaderValue, Method};
use thiserror::Error;

use super::identity::CanonicalOrigin;
use super::localapi::Whois;

#[derive(Debug, thiserror::Error, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    #[error("tagged")]
    Tagged,
    #[error("login mismatch")]
    LoginMismatch,
    #[error("shared node")]
    Shared,
    #[error("subnet router")]
    Routes,
    #[error("the server's own node")]
    SelfNode,
    #[error("unknown node")]
    UnknownNode,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tagged => "tagged",
            Self::LoginMismatch => "login_mismatch",
            Self::Shared => "shared",
            Self::Routes => "routes",
            Self::SelfNode => "self",
            Self::UnknownNode => "unknown_node",
        }
    }
}

#[derive(Debug, Error)]
pub enum Error {
    #[error("invalid X-Forwarded-For")]
    ForwardedAddress,
    #[error("browser request doesn't match the canonical origin")]
    BadOrigin,
    #[error("node refused: {0}")]
    Refused(Reason),
}

#[derive(Debug, Clone)]
pub struct Node {
    pub id: String,
    pub address: IpAddr,
    pub login: String,
    pub name: String,
}

pub fn forwarded_addr(headers: &HeaderMap) -> Result<IpAddr, Error> {
    let value = unique(headers, "x-forwarded-for")?.ok_or(Error::ForwardedAddress)?;
    let value = value.to_str().map_err(|_| Error::ForwardedAddress)?;
    if value.contains(',') {
        return Err(Error::ForwardedAddress);
    }
    let address = IpAddr::from_str(value).map_err(|_| Error::ForwardedAddress)?;
    if !is_tailnet_address(address) {
        return Err(Error::ForwardedAddress);
    }
    Ok(address)
}

pub fn node_rules(
    whois: &Whois,
    address: IpAddr,
    login: &str,
    self_id: &str,
) -> Result<Node, Error> {
    let Some(node) = &whois.node else {
        return Err(Error::Refused(Reason::UnknownNode));
    };
    let Some(profile) = &whois.user_profile else {
        return Err(Error::Refused(Reason::LoginMismatch));
    };
    if node.stable_id.is_empty() {
        return Err(Error::Refused(Reason::UnknownNode));
    }
    if !node.tags.is_empty() {
        return Err(Error::Refused(Reason::Tagged));
    }
    if profile.login_name != login {
        return Err(Error::Refused(Reason::LoginMismatch));
    }
    if node.sharer != 0 {
        return Err(Error::Refused(Reason::Shared));
    }
    let addresses: HashSet<String> = node
        .addresses
        .iter()
        .map(|address| address.to_ascii_lowercase())
        .collect();
    if node.allowed_ips.iter().any(|route| {
        let route = route.to_ascii_lowercase();
        !addresses.contains(&route) && route != "0.0.0.0/0" && route != "::/0"
    }) {
        return Err(Error::Refused(Reason::Routes));
    }
    if node.stable_id == self_id {
        return Err(Error::Refused(Reason::SelfNode));
    }
    Ok(Node {
        id: node.stable_id.clone(),
        address,
        login: profile.login_name.clone(),
        name: node
            .dns_name
            .trim_end_matches('.')
            .split('.')
            .next()
            .unwrap_or_default()
            .to_owned(),
    })
}

pub fn admission(
    method: &Method,
    upgrade: bool,
    headers: &HeaderMap,
    origin: &CanonicalOrigin,
) -> Result<(), Error> {
    let forwarded = unique(headers, "x-forwarded-host")?.ok_or(Error::BadOrigin)?;
    let forwarded = forwarded
        .to_str()
        .map_err(|_| Error::BadOrigin)?
        .to_ascii_lowercase();
    if normalize_authority(&forwarded) != origin.authority {
        return Err(Error::BadOrigin);
    }

    let get_or_head = method == Method::GET || method == Method::HEAD;
    let origin_header = unique(headers, "origin")?;
    if upgrade || !get_or_head {
        let value = origin_header.ok_or(Error::BadOrigin)?;
        if !value
            .to_str()
            .is_ok_and(|value| value.eq_ignore_ascii_case(&origin.origin))
        {
            return Err(Error::BadOrigin);
        }
    } else if let Some(value) = origin_header {
        if !value
            .to_str()
            .is_ok_and(|value| value.eq_ignore_ascii_case(&origin.origin))
        {
            return Err(Error::BadOrigin);
        }
    }

    let fetch_site = unique(headers, "sec-fetch-site")?;
    if get_or_head {
        if fetch_site.and_then(|value| value.to_str().ok()) != Some("same-origin") {
            return Err(Error::BadOrigin);
        }
    } else if fetch_site.is_some_and(|value| value.to_str().ok() != Some("same-origin")) {
        return Err(Error::BadOrigin);
    }
    Ok(())
}

fn unique<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a HeaderValue>, Error> {
    let values = headers.get_all(name);
    let mut iter = values.iter();
    let first = iter.next();
    if iter.next().is_some() {
        return Err(
            if name == "origin" || name == "x-forwarded-host" || name == "sec-fetch-site" {
                Error::BadOrigin
            } else {
                Error::ForwardedAddress
            },
        );
    }
    Ok(first)
}

fn normalize_authority(authority: &str) -> String {
    authority
        .strip_suffix(":443")
        .unwrap_or(authority)
        .to_owned()
}

fn is_tailnet_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let value = u32::from(address);
            value & 0xffc0_0000 == u32::from_be_bytes([100, 64, 0, 0])
        }
        IpAddr::V6(address) => address.octets()[..6] == [0xfd, 0x7a, 0x11, 0x5c, 0xa1, 0xe0],
    }
}
