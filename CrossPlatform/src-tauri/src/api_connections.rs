//! A connection check sends the supplied key only to the selected built-in
//! provider. It never uploads audio, generates content or follows redirects.
use reqwest::{header::{HeaderName,HeaderValue},Client};
use std::time::Duration;

struct Probe {
    url: &'static str,
    header: &'static str,
    prefix: &'static str,
    version: Option<&'static str>,
}

// Read-only authentication endpoints, verified against the provider's docs.
// Supported speech models are defined by models::catalog, not guessed from keys.
fn probe(provider:&str)->Result<Probe,String> {
    let (url,header,prefix,version)=match provider {
        "openai"=>("https://api.openai.com/v1/models","authorization","Bearer ",None),
        "groq"=>("https://api.groq.com/openai/v1/models","authorization","Bearer ",None),
        "mistral"=>("https://api.mistral.ai/v1/models","authorization","Bearer ",None),
        "deepgram"=>("https://api.deepgram.com/v1/auth/token","authorization","Token ",None),
        "elevenlabs"=>("https://api.elevenlabs.io/v1/models","xi-api-key","",None),
        "gemini"=>("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash","x-goog-api-key","",None),
        "soniox"=>("https://api.soniox.com/v1/models","authorization","Bearer ",None),
        "assemblyai"=>("https://api.assemblyai.com/v2/transcript?limit=1","authorization","",None),
        "speechmatics"=>("https://asr.api.speechmatics.com/v2/jobs/","authorization","Bearer ",None),
        "xai"=>("https://api.x.ai/v1/models","authorization","Bearer ",None),
        "cartesia"=>("https://api.cartesia.ai/voices?limit=1","authorization","Bearer ",Some("2026-08-14")),
        _=>return Err("Choose a supported API provider".into()),
    };
    Ok(Probe{url,header,prefix,version})
}

fn client()->Result<Client,String> {
    Client::builder().timeout(Duration::from_secs(20)).connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|_|"Could not prepare the connection check".into())
}

fn authorization(spec:&Probe,key:&str)->Result<HeaderValue,String> {
    if key.is_empty()||key.len()>8192||key.chars().any(char::is_control) {
        return Err("Enter a valid API key".into());
    }
    let mut value=HeaderValue::from_str(&format!("{}{key}",spec.prefix)).map_err(|_|"Enter a valid API key")?;
    value.set_sensitive(true);
    Ok(value)
}

async fn verify_at(client:&Client,spec:&Probe,url:&str,key:&str)->Result<(),String> {
    let mut request=client.get(url).header(HeaderName::from_static(spec.header),authorization(spec,key)?);
    if let Some(version)=spec.version {request=request.header("Cartesia-Version",version);}
    let response=request.send().await.map_err(|error|if error.is_timeout(){"The connection check timed out. Try again."}else{"Could not reach the provider. Check your connection and try again."}.to_string())?;
    // Do not read or retain account details, job lists or error bodies. They can
    // contain private data or echo the supplied key. Check status and JSON MIME
    // so a proxy/login/challenge page cannot pass as a provider API response.
    let json=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value|value.to_str().ok())
        .and_then(|value|value.split(';').next()).map(str::trim)
        .is_some_and(|value|value.eq_ignore_ascii_case("application/json")||value.to_ascii_lowercase().ends_with("+json"));
    match response.status().as_u16() {
        200..=299 if json=>Ok(()),
        200..=299=>Err("The provider returned an unexpected connection response. Try again later.".into()),
        401=>Err("API key rejected. Check the key and selected provider.".into()),
        403=>Err("The provider denied the connection check. Check key permissions or try again later.".into()),
        429=>Err("Provider rate limit reached. Try again later.".into()),
        300..=399=>Err("The provider redirected the connection check. The key was not forwarded.".into()),
        404=>Err("The provider's connection check is unavailable. Try again later.".into()),
        _=>Err("The provider could not confirm the connection. Try again later.".into()),
    }
}

async fn connect_at(client:&Client,spec:&Probe,url:&str,key:&str,save:impl FnOnce(&str)->Result<(),String>)->Result<(),String> {
    let key=key.trim();
    verify_at(client,spec,url,key).await?;
    save(key)
}

pub async fn connect(provider:&str,key:&str)->Result<(),String> {
    let spec=probe(provider)?;
    connect_at(&client()?,&spec,spec.url,key,|key|crate::credentials::save(provider,key)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{Read,Write},net::TcpListener,sync::{Arc,Mutex}};

    fn fixture(status:&str,extra:&str)->(String,Arc<Mutex<String>>,std::thread::JoinHandle<()>) {
        let server=TcpListener::bind("127.0.0.1:0").unwrap();
        let url=format!("http://{}/check",server.local_addr().unwrap());
        let captured=Arc::new(Mutex::new(String::new()));
        let sink=captured.clone();let status=status.to_string();let extra=extra.to_string();
        let thread=std::thread::spawn(move||{
            let (mut stream,_)=server.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut bytes=vec![];let mut buffer=[0u8;1024];
            while !bytes.windows(4).any(|x|x==b"\r\n\r\n") {let n=stream.read(&mut buffer).unwrap();if n==0 {break;}bytes.extend_from_slice(&buffer[..n]);}
            *sink.lock().unwrap()=String::from_utf8(bytes).unwrap();
            // Deliberately include a secret in the body: it must never escape.
            let body="test-secret-must-not-escape";
            let content_type=if extra.contains("Content-Type:"){""}else{"Content-Type: application/json\r\n"};
            let _=write!(stream,"HTTP/1.1 {status}\r\n{extra}{content_type}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        });
        (url,captured,thread)
    }

    #[test]
    fn destinations_are_fixed_and_unknown_providers_are_rejected() {
        for provider in ["openai","groq","mistral","deepgram","elevenlabs","gemini","soniox","assemblyai","speechmatics","xai","cartesia"] {
            let spec=probe(provider).unwrap();let url=reqwest::Url::parse(spec.url).unwrap();
            assert_eq!(url.scheme(),"https");assert!(url.username().is_empty());assert!(url.password().is_none());
            assert!(!spec.url.contains("key="));
        }
        assert!(probe("https://attacker.example").is_err());assert!(probe("custom-openai").is_err());
    }

    #[test]
    fn malformed_keys_never_form_a_request_and_header_values_are_sensitive() {
        let spec=probe("gemini").unwrap();
        for key in ["","bad\r\nheader: value","bad\0key"] {assert!(authorization(&spec,key).is_err());}
        assert!(authorization(&spec,"fixture-key").unwrap().is_sensitive());
    }

    #[tokio::test]
    async fn rejected_keys_do_not_replace_saved_credentials_or_expose_response_bodies() {
        let (url,_,thread)=fixture("401 Unauthorized","");let saved=std::cell::Cell::new(false);
        let result=connect_at(&client().unwrap(),&probe("openai").unwrap(),&url,"fixture-key",|_|{saved.set(true);Ok(())}).await;
        thread.join().unwrap();assert!(!saved.get());let error=result.unwrap_err();
        assert!(error.contains("rejected"));assert!(!error.contains("must-not-escape"));assert!(!error.contains("fixture-key"));
    }

    #[tokio::test]
    async fn successful_check_is_get_only_and_then_saves_the_trimmed_key() {
        let (url,captured,thread)=fixture("200 OK","");let saved=std::cell::RefCell::new(String::new());
        connect_at(&client().unwrap(),&probe("deepgram").unwrap(),&url,"  fixture-key  ",|key|{*saved.borrow_mut()=key.into();Ok(())}).await.unwrap();
        thread.join().unwrap();assert_eq!(&*saved.borrow(),"fixture-key");
        let request=captured.lock().unwrap().to_ascii_lowercase();assert!(request.starts_with("get /check http/1.1"));
        assert!(request.contains("authorization: token fixture-key"));assert!(request.ends_with("\r\n\r\n"));assert!(!request.contains("multipart"));
    }

    #[tokio::test]
    async fn redirects_are_not_followed_or_saved() {
        let (url,_,thread)=fixture("302 Found","Location: http://127.0.0.1:1/other\r\n");
        let result=connect_at(&client().unwrap(),&probe("gemini").unwrap(),&url,"fixture-key",|_|panic!("must not save")).await;
        thread.join().unwrap();assert!(result.unwrap_err().contains("not forwarded"));
    }

    #[tokio::test]
    async fn html_challenges_cannot_connect_or_replace_a_key_even_with_http_200() {
        let (url,_,thread)=fixture("200 OK","Content-Type: text/html\r\n");
        let result=connect_at(&client().unwrap(),&probe("elevenlabs").unwrap(),&url,"fixture-key",|_|panic!("must not save")).await;
        thread.join().unwrap();assert!(result.unwrap_err().contains("unexpected connection response"));
    }
}
