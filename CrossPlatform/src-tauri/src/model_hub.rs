//! Public Hugging Face metadata is the catalog; weights stay pinned after installation.
use crate::{domain::Model, store::err};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex, time::Duration};

const WHISPER_REPO: &str = "ggerganov/whisper.cpp";
const MAX_METADATA: usize = 4 * 1024 * 1024;
const REFRESH_SECONDS: i64 = 6 * 3600;
static WRITES: Mutex<()> = Mutex::new(());
static REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="lowercase")]
pub enum Kind { Speech, Text }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleFile { pub path:String, pub size:u64, pub sha256:String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Asset {
    pub kind: Kind,
    pub repository: String,
    pub revision: String,
    pub file: String,
    pub size: u64,
    pub sha256: String,
    pub name: String,
    pub languages: String,
    #[serde(default)]
    pub language_codes: Vec<String>,
    pub description: String,
    pub license: String,
    pub architecture: String,
    pub quantization: String,
    #[serde(default, skip_serializing_if="Vec::is_empty")]
    pub files: Vec<BundleFile>,
}

fn hex(value: &str, length: usize) -> bool { value.len()==length && value.bytes().all(|c|c.is_ascii_hexdigit()) }
fn segment(value: &str) -> bool {
    !value.is_empty() && value!="." && value!=".." && value.bytes().all(|c|c.is_ascii_alphanumeric() || matches!(c,b'-'|b'_'|b'.'))
}
fn repository(value: &str) -> bool { value.len()<=200 && value.split('/').count()==2 && value.split('/').all(segment) }
fn supported_architecture(value: &str) -> bool {
    serde_json::from_str::<Vec<String>>(include_str!("../text-model-architectures.json")).unwrap().iter().any(|a|a==value)
}

impl Asset {
    pub fn id(&self) -> String {
        if self.kind==Kind::Speech && !self.files.is_empty() {
            if self.architecture=="coreml" {return crate::gigaam::ID.into();}
            return crate::sherpa::bundle_id(&self.repository,&self.file).unwrap_or("unsupported-speech-bundle").into();
        }
        if self.kind==Kind::Speech { return format!("whisper-{}", self.file.trim_start_matches("ggml-").trim_end_matches(".bin")); }
        // Existing preferences keep their identifiers and installed files.
        if self.repository.starts_with("unsloth/Qwen3.5-") && self.file.ends_with("-Q4_K_M.gguf") {
            let size=self.repository.trim_start_matches("unsloth/Qwen3.5-").trim_end_matches("-GGUF");
            if self.file==format!("Qwen3.5-{size}-Q4_K_M.gguf") {return format!("qwen3.5-{}",size.to_lowercase());}
        }
        let hash=format!("{:x}",Sha256::digest(format!("{}\0{}",self.repository,self.file)));
        format!("hf-text-{}",&hash[..24])
    }
    pub fn validate(&self) -> Result<(),String> {
        if !repository(&self.repository) || !hex(&self.revision,40) || !hex(&self.sha256,64)
            || self.file.len()>500 || !self.file.split('/').all(segment) || self.size<24 || self.size>100_000_000_000
            || self.name.is_empty() || self.name.len()>200 || self.description.len()>500 || self.languages.len()>100 || self.license.len()>100
            || self.language_codes.len()>300 || self.language_codes.iter().any(|c|c.is_empty() || c.len()>30 || !c.bytes().all(|v|v.is_ascii_alphanumeric() || v==b'-')) {
            return Err("Invalid model catalog entry".into());
        }
        match self.kind {
            Kind::Speech if !self.files.is_empty()=>{
                let template=bundled_speech().into_iter().find(|a|a.repository==self.repository && a.architecture==self.architecture && a.file==self.file).ok_or("Unsupported speech model bundle")?;
                if self.revision!=template.revision || self.file!=template.file || self.size!=template.size || self.sha256!=template.sha256
                    || self.files.len()!=template.files.len() || !self.files.iter().zip(&template.files).all(|(a,b)|a.path==b.path&&a.size==b.size&&a.sha256==b.sha256) {
                    return Err("Invalid speech model bundle".into());
                }
                Ok(())
            },
            Kind::Speech if self.repository==WHISPER_REPO && self.architecture=="whisper" && whisper_variant(&self.file).is_some()=>Ok(()),
            Kind::Text if self.files.is_empty() && supported_architecture(&self.architecture) && text_quantization(&self.file).is_some()=>Ok(()),
            _=>Err("This model is not supported by the bundled engine".into()),
        }
    }
    pub fn url(&self) -> String {
        self.file_url(&self.file)
    }
    pub fn file_url(&self,file:&str) -> String {
        let mut url=url::Url::parse("https://huggingface.co").unwrap();
        let mut path=url.path_segments_mut().unwrap();
        for s in self.repository.split('/') {path.push(s);}
        path.push("resolve").push(&self.revision);
        for s in file.split('/') {path.push(s);}
        drop(path);
        url.into()
    }
    pub fn path(&self, root: &Path) -> PathBuf {
        match self.kind {
            Kind::Text=>root.join("text-models").join(format!("{}.gguf",self.id())),
            Kind::Speech=>{
                if !self.files.is_empty() {
                    if self.id()==crate::gigaam::ID {
                        return crate::gigaam::model_path(root,dirs::home_dir().map(|home|crate::legacy::native_root(&home).join("GigaAMModels").join(crate::gigaam::ID)));
                    }
                    return root.join("models").join(self.id());
                }
                let current=root.join("models").join(&self.file);
                if current.is_file() {return current;}
                dirs::home_dir().map(|home|crate::legacy::native_root(&home).join("WhisperModels").join(&self.file)).filter(|p|p.is_file()).unwrap_or(current)
            },
        }
    }
    pub fn installed(&self, root:&Path) -> bool {
        let path=self.path(root);
        if !self.files.is_empty() {return self.files.iter().all(|f|std::fs::metadata(path.join(&f.path)).is_ok_and(|m|m.is_file()&&m.len()==f.size));}
        if !std::fs::metadata(&path).is_ok_and(|m|m.len()==self.size) {return false;}
        match self.kind {Kind::Text=>crate::text_models::gguf(&path).is_ok(),Kind::Speech=>whisper_file(&path).is_ok()}
    }
    pub fn model(&self, root:&Path) -> Model {
        Model {id:self.id(), name:self.name.clone(),provider:if self.kind==Kind::Text {"local"} else if self.architecture=="coreml" {"coreml"} else if !self.files.is_empty() {"sherpa-onnx"} else {"whisper"}.into(),
            model:if self.kind==Kind::Speech && self.files.is_empty() {self.file.trim_start_matches("ggml-").trim_end_matches(".bin").into()} else {self.id()},
            endpoint:String::new(),local:true,path:Some(self.path(root).to_string_lossy().into()),download_url:Some(self.url()),size:self.size,
            installed:self.installed(root),has_key:true,languages:self.languages.clone(),description:self.description.clone()}
    }
}

fn whisper_variant(file:&str) -> Option<&str> {
    let variant=file.strip_prefix("ggml-")?.strip_suffix(".bin")?;
    // These are whisper.cpp model families, including their English/quantized files.
    let base=variant.split("-q").next()?;
    let base=base.strip_suffix(".en").unwrap_or(base);
    if segment(variant) && matches!(base,"tiny"|"base"|"small"|"medium"|"large-v1"|"large-v2"|"large-v3"|"large-v3-turbo"|"distil-medium"|"distil-large-v2"|"distil-large-v3") {Some(variant)} else {None}
}
pub fn whisper_file(path:&Path) -> Result<(),String> {
    let mut header=[0u8;4];
    std::fs::File::open(path).map_err(err)?.read_exact(&mut header).map_err(err)?;
    if u32::from_le_bytes(header)!=0x67676d6c {return Err("Invalid whisper.cpp model file".into());}
    Ok(())
}
fn text_quantization(file:&str) -> Option<&'static str> {
    let file=file.to_uppercase();
    if !file.ends_with(".GGUF") || file.contains("MMPROJ") || file.contains("-OF-") || file.contains("-UD-") {return None;}
    ["Q4_K_M","Q4_K_S","Q5_K_M","Q5_K_S","Q6_K","Q8_0","Q4_0","Q4_1","Q5_0","Q5_1","IQ4_NL","IQ4_XS","Q3_K_M","Q3_K_S","Q2_K","F16","BF16","F32"].into_iter()
        .find(|q|file.ends_with(&format!("-{q}.GGUF")) || file.ends_with(&format!(".{q}.GGUF")))
}

#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
struct Cache {schema:u32,updated_at:Option<i64>,attempted_at:Option<i64>,error:Option<String>,assets:Vec<Asset>}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Status {pub source:&'static str,pub updated_at:Option<i64>,pub error:Option<String>,pub count:usize}
fn bundled_speech()->Vec<Asset> {
    bundled_speech_for(cfg!(target_os="macos"))
}
fn bundled_speech_for(macos:bool)->Vec<Asset> {
    let mut assets:Vec<Asset>=serde_json::from_str(include_str!("../speech-model-bundles.json")).expect("valid speech model bundles");
    if macos {
        let files:Vec<_>=crate::gigaam::assets().into_iter().map(|a|BundleFile{path:a.path,size:a.size,sha256:a.sha256}).collect();
        assets.push(Asset{kind:Kind::Speech,repository:"smkrv/gigaam-v3-e2e-rnnt-coreml".into(),revision:crate::gigaam::REPOSITORY.rsplit('/').next().unwrap().into(),
            file:files[0].path.clone(),size:files.iter().map(|f|f.size).sum(),sha256:files[0].sha256.clone(),name:"GigaAM v3".into(),languages:"Russian".into(),language_codes:vec!["ru".into()],
            description:"Sber · Russian speech recognition · fully offline · CoreML".into(),license:"mit".into(),architecture:"coreml".into(),quantization:"F16".into(),files});
    }
    assets
}
fn seed() -> Cache {
    let mut cache:Cache=serde_json::from_str(include_str!("../model-hub-seed.json")).expect("valid offline model seed");
    cache.assets.extend(bundled_speech());cache
}
fn restored(root:&Path)->Cache {
    let mut current=seed();
    // Installation receipts outlive a lost or malformed catalog cache.
    if let Ok(files)=std::fs::read_dir(root.join("model-hub/installed")) {
        for file in files.flatten().take(2000) {
            if file.metadata().is_ok_and(|m|m.is_file()&&m.len()<64*1024) {
                if let Some(asset)=std::fs::read(file.path()).ok().and_then(|b|serde_json::from_slice::<Asset>(&b).ok()).filter(|a|a.validate().is_ok()&&a.installed(root)) {
                    current.assets.retain(|a|a.id()!=asset.id());current.assets.push(asset);
                }
            }
        }
    }
    current
}
fn cache_path(root:&Path) -> PathBuf {root.join("model-hub/catalog-v1.json")}
fn cache(root:&Path) -> Cache {
    let path=cache_path(root);
    let mut current=std::fs::metadata(&path).ok().filter(|m|m.len()<=MAX_METADATA as u64)
        .and_then(|_|std::fs::read(&path).ok()).and_then(|b|serde_json::from_slice::<Cache>(&b).ok())
        .filter(|c|c.schema==1 && c.assets.len()<=2000 && !c.assets.is_empty() && c.assets.iter().all(|a|a.validate().is_ok()))
        .unwrap_or_else(||restored(root));
    // Newly shipped models must appear even when an older cache is still fresh.
    for asset in seed().assets {if !current.assets.iter().any(|a|a.id()==asset.id()) {current.assets.push(asset);}}
    current
}
fn write(root:&Path, value:&Cache) -> Result<(),String> {
    let path=cache_path(root);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(err)?;
    let bytes=serde_json::to_vec(value).map_err(err)?;
    if bytes.len()>MAX_METADATA || value.assets.len()>2000 {return Err("The model catalog is full".into());}
    let pending=path.with_extension(format!("{}.part",uuid::Uuid::new_v4()));
    let result=(||{
        let mut file=std::fs::File::create(&pending).map_err(err)?;
        file.write_all(&bytes).map_err(err)?; file.sync_all().map_err(err)?;drop(file);
        std::fs::rename(&pending,&path).map_err(err)
    })();
    if result.is_err(){let _=std::fs::remove_file(&pending);}
    result
}
fn status_of(value:&Cache)->Status {Status {source:"Hugging Face",updated_at:value.updated_at,error:value.error.clone(),count:value.assets.len()}}
pub fn status(root:&Path)->Status {status_of(&cache(root))}
pub fn assets(root:&Path,kind:Kind)->Vec<Asset> {cache(root).assets.into_iter().filter(|a|a.kind==kind).collect()}
pub fn asset(root:&Path,id:&str)->Option<Asset> {cache(root).assets.into_iter().find(|a|a.id()==id)}
pub fn remember_install(root:&Path,asset:&Asset)->Result<(),String> {
    let _guard=WRITES.lock().map_err(err)?;
    let receipts=root.join("model-hub/installed");std::fs::create_dir_all(&receipts).map_err(err)?;
    let receipt=receipts.join(format!("{}.json",asset.id()));
    let pending=receipt.with_extension("part");
    let mut file=std::fs::File::create(&pending).map_err(err)?;
    file.write_all(&serde_json::to_vec(asset).map_err(err)?).map_err(err)?;file.sync_all().map_err(err)?;drop(file);
    std::fs::rename(pending,receipt).map_err(err)?;
    let mut current=cache(root);current.assets.retain(|a|a.id()!=asset.id());current.assets.push(asset.clone());write(root,&current)
}

fn merge(root:&Path, incoming:Vec<Asset>, checked:bool, error:Option<String>) -> Result<Status,String> {
    let _guard=WRITES.lock().map_err(err)?;
    let mut current=cache(root);
    for next in incoming {
        next.validate()?;
        if let Some(old)=current.assets.iter_mut().find(|a|a.id()==next.id()) {
            // A catalog refresh cannot invalidate or replace installed weights.
            if !old.installed(root) {*old=next;}
        } else {current.assets.push(next);}
    }
    if checked {
        current.attempted_at=Some(chrono::Utc::now().timestamp());
        if error.is_none(){current.updated_at=current.attempted_at;}
        current.error=error;
    }
    write(root,&current)?;
    Ok(status_of(&current))
}

fn client()->Result<reqwest::Client,String> {
    reqwest::Client::builder().https_only(true).user_agent("NoType-ModelCatalog/1")
        .connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(25)).build().map_err(err)
}
async fn json(client:&reqwest::Client,url:url::Url)->Result<Value,String> {
    let response=client.get(url).send().await.map_err(err)?.error_for_status().map_err(err)?;
    let mut stream=response.bytes_stream();let mut bytes=Vec::new();
    while let Some(chunk)=stream.next().await {let chunk=chunk.map_err(err)?;if bytes.len()+chunk.len()>MAX_METADATA{return Err("Model metadata is too large".into());}bytes.extend_from_slice(&chunk);}
    serde_json::from_slice(&bytes).map_err(err)
}
async fn info(client:&reqwest::Client,repo:&str,revision:Option<&str>)->Result<Value,String> {
    if !repository(repo) || revision.is_some_and(|r|!hex(r,40)) {return Err("Enter a Hugging Face repository such as author/model".into());}
    let mut url=url::Url::parse("https://huggingface.co/api/models/").unwrap();
    {let mut path=url.path_segments_mut().unwrap();path.pop_if_empty();for s in repo.split('/') {path.push(s);}if let Some(r)=revision{path.push("revision").push(r);}}
    url.query_pairs_mut().append_pair("blobs","true");
    json(client,url).await
}
fn language_codes(info:&Value)->Vec<String> {
    let languages=&info["cardData"]["language"];
    if let Some(s)=languages.as_str(){vec![s.into()]} else {languages.as_array().map(|a|a.iter().filter_map(Value::as_str).take(300).map(str::to_owned).collect()).unwrap_or_default()}
}
fn language_label(info:&Value)->String {
    let values=language_codes(info);
    if values.len()>1 {return "Multilingual".into();}
    match values.first().map(String::as_str){Some("en")=>"English",Some("ru")=>"Russian",Some("multilingual")=>"Multilingual",Some(code)=>code,None=>"Not specified"}.into()
}
fn from_info(info:&Value,kind:Kind)->Vec<Asset> {
    if info["private"].as_bool()==Some(true) || !(info["gated"].is_null() || info["gated"].as_bool()==Some(false)) {return vec![];}
    let Some(repo)=info["id"].as_str() else {return vec![]};
    let Some(revision)=info["sha"].as_str().filter(|s|hex(s,40)) else {return vec![]};
    if kind==Kind::Speech {
        let bundles:Vec<_>=bundled_speech().into_iter().filter(|a|a.repository==repo).collect();
        if !bundles.is_empty() {
            // Bundles are pinned to a tested conversion. Every member, including
            // non-LFS token files, keeps its verified checksum from that revision.
            return bundles.into_iter().filter(|asset|revision==asset.revision && asset.files.iter().all(|f|info["siblings"].as_array().is_some_and(|files|files.iter().any(|v|
                v["rfilename"].as_str()==Some(&f.path) && v["size"].as_u64().or(v["lfs"]["size"].as_u64())==Some(f.size)
                && v["lfs"]["sha256"].as_str().is_none_or(|hash|hash==f.sha256))))).collect();
        }
    }
    let architecture=if kind==Kind::Speech {"whisper"} else {info["gguf"]["architecture"].as_str().unwrap_or("")};
    if kind==Kind::Text && (!supported_architecture(architecture) || info["gguf"]["chat_template"].as_str().is_none_or(|s|s.trim().is_empty())
        || !matches!(info["pipeline_tag"].as_str(),Some("text-generation"|"image-text-to-text"))) {return vec![];}
    let license=info["cardData"]["license"].as_str().unwrap_or("See model card");
    info["siblings"].as_array().into_iter().flatten().filter_map(|file|{
        let filename=file["rfilename"].as_str()?;
        let quantization=match kind {Kind::Speech=>{let variant=whisper_variant(filename)?;variant.split("-q").nth(1).map(|q|format!("Q{q}")).unwrap_or_else(||"F16".into())},Kind::Text=>text_quantization(filename)?.into()};
        let size=file["lfs"]["size"].as_u64().or(file["size"].as_u64())?;
        let sha=file["lfs"]["sha256"].as_str()?;
        let mut asset=Asset {kind,repository:repo.into(),revision:revision.into(),file:filename.into(),size,sha256:sha.into(),name:String::new(),
            languages:if kind==Kind::Speech {if filename.contains(".en") {"English"} else {"Multilingual"}.into()} else {language_label(info)},
            language_codes:if kind==Kind::Text {language_codes(info)} else if filename.contains(".en") {vec!["en".into()]} else {vec!["multilingual".into()]},
            description:format!("{repo} · {quantization} · {license}"),license:license.into(),architecture:architecture.into(),quantization,files:vec![]};
        if kind==Kind::Speech {
            let variant=whisper_variant(filename)?;
            asset.name=format!("Whisper {}",variant.replace('-'," "));
        } else {
            asset.name=format!("{} · {}",repo.split('/').next_back()?.trim_end_matches("-GGUF").trim_end_matches("-gguf"),asset.quantization);
        }
        if let Some(original)=seed().assets.into_iter().find(|a|a.id()==asset.id()) {asset.name=original.name;asset.description=original.description;asset.languages=original.languages;}
        asset.validate().ok()?;
        Some(asset)
    }).collect()
}

#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Search {pub kind:Kind,pub query:String,pub quantization:Option<String>,pub max_bytes:Option<u64>,pub language:Option<String>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SearchEntry {pub asset:Asset,pub model:Model}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SearchResult {pub models:Vec<SearchEntry>,pub cached:bool,pub warning:Option<String>}

fn matching(asset:&Asset,search:&Search)->bool {
    if search.max_bytes.is_some_and(|s|asset.size>s) {return false;}
    if search.quantization.as_ref().is_some_and(|q|q!="all"&&q!=&asset.quantization) {return false;}
    if let Some(language)=search.language.as_deref().filter(|l|*l!="all") {
        if !asset.language_codes.is_empty() {
            if !asset.language_codes.iter().any(|code|code=="multilingual"||code==language||code.split('-').next()==Some(language)) {return false;}
        } else if asset.languages!="Multilingual"&&asset.languages!=match language {"en"=>"English","ru"=>"Russian",other=>other} {return false;}
    }
    true
}
fn query_repo(query:&str)->Option<String> {
    if repository(query) {return Some(query.into());}
    let url=url::Url::parse(query).ok()?;
    if url.scheme()!="https" || url.host_str()!=Some("huggingface.co") {return None;}
    let repo=url.path().trim_matches('/');repository(repo).then(||repo.into())
}
fn query_matches(asset:&Asset,query:&str)->bool {
    let publisher=if asset.id().starts_with("gigaam-") {"Sber Сбер гигаам гигачат GigaChat"} else {match asset.architecture.as_str() {"nemo_transducer"=>"NVIDIA инвидия паракет", "whisper"=>"OpenAI Open AI опен аи виспер",_=>""}};
    format!("{} {} {} {} {}",asset.name,asset.file,asset.repository,asset.description,publisher).to_lowercase().contains(&query.to_lowercase())
}
pub fn speech_rank(asset:&Asset)->usize {
    match asset.id().as_str() {
        crate::sherpa::PARAKEET_ID=>0, crate::gigaam::ID=>1,
        crate::sherpa::GIGAAM_V3_ID=>1,crate::sherpa::GIGAAM_MULTILINGUAL_ID|crate::sherpa::GIGAAM_MULTILINGUAL_LARGE_ID=>4,
        "whisper-large-v3-turbo"=>2,"whisper-large-v3"=>3,_=>100,
    }
}
fn speech_results(root:&Path,assets:Vec<Asset>,query:&str)->Vec<Asset> {
    assets.into_iter().filter(|a|query_matches(a,query) && (!query.trim().is_empty() || speech_rank(a)<100 || a.installed(root))).collect()
}
async fn discover(client:&reqwest::Client,search:&Search)->Result<Vec<Asset>,String> {
    if search.kind==Kind::Speech {
        if let Some(repo)=query_repo(search.query.trim()) {
            let revision=bundled_speech().into_iter().find(|a|a.repository==repo).map(|a|a.revision);
            return Ok(from_info(&info(client,&repo,revision.as_deref()).await?,Kind::Speech));
        }
        let mut entries=from_info(&info(client,WHISPER_REPO,None).await?,Kind::Speech);
        entries.extend(bundled_speech());
        return Ok(entries.into_iter().filter(|a|query_matches(a,search.query.trim())).collect());
    }
    if let Some(repo)=query_repo(search.query.trim()) {return Ok(from_info(&info(client,&repo,None).await?,Kind::Text));}
    let mut url=url::Url::parse("https://huggingface.co/api/models").unwrap();
    url.query_pairs_mut().append_pair("filter","gguf").append_pair("search",search.query.trim()).append_pair("sort","downloads").append_pair("direction","-1").append_pair("limit","20");
    let models=json(client,url).await?;
    let ids:Vec<String>=models.as_array().ok_or("Invalid model search response")?.iter().filter_map(|m|m["id"].as_str()).filter(|s|repository(s)).map(str::to_owned).collect();
    let results:Vec<Result<Vec<Asset>,String>>=stream::iter(ids.into_iter().map(|repo|async move {Ok(from_info(&info(client,&repo,None).await?,Kind::Text))})).buffer_unordered(4).collect().await;
    let failed=results.iter().filter(|r|r.is_err()).count();
    if !results.is_empty() && failed==results.len() {return Err("Hugging Face model metadata is unavailable".into());}
    Ok(results.into_iter().filter_map(Result::ok).flatten().collect())
}
pub async fn search(root:&Path,search:Search)->Result<SearchResult,String> {
    if search.query.len()>200 || search.query.chars().any(char::is_control) {return Err("Use a shorter model name or repository".into());}
    let saved=assets(root,search.kind);
    let local=search.kind==Kind::Speech && query_repo(search.query.trim()).is_none() &&
        (search.query.trim().is_empty() || (saved.iter().any(|a|!a.files.is_empty()&&query_matches(a,search.query.trim())) &&
            !saved.iter().any(|a|a.files.is_empty()&&query_matches(a,search.query.trim()))));
    // The known families appear immediately; automatic refresh updates the
    // saved catalog independently of this view and network search.
    let remote=if local {Ok(saved.into_iter().filter(|a|query_matches(a,search.query.trim())).collect())} else {discover(&client()?,&search).await};
    let cached=local||remote.is_err();
    let warning=remote.is_err().then(||"Hugging Face is unavailable. Showing matches from the saved catalog.".into());
    let query=query_repo(search.query.trim()).unwrap_or_else(||search.query.trim().to_owned()).to_lowercase();
    let installed:Vec<_>=assets(root,search.kind).into_iter().filter(|a|a.installed(root)).collect();
    let candidates=remote.unwrap_or_else(|_|assets(root,search.kind).into_iter().filter(|a|query_matches(a,&query)).collect());
    let candidates=if search.kind==Kind::Speech {speech_results(root,candidates,&query)} else {candidates};
    let mut models:Vec<_>=candidates.into_iter()
        .map(|a|installed.iter().find(|old|old.id()==a.id()).cloned().unwrap_or(a))
        .filter(|a|matching(a,&search)).take(120).map(|a|SearchEntry{model:a.model(root),asset:a}).collect();
    models.sort_by_key(|m|(if search.kind==Kind::Speech {speech_rank(&m.asset)} else {0},!m.model.installed,m.asset.size,m.model.name.clone()));
    Ok(SearchResult{models,cached,warning})
}
pub async fn add(root:&Path,kind:Kind,repo:&str,revision:&str,file:&str)->Result<Model,String> {
    if kind==Kind::Speech {
        if let Some(entry)=bundled_speech().into_iter().find(|a|a.repository==repo&&a.revision==revision&&a.file==file) {
            let id=entry.id();merge(root,vec![entry],false,None)?;
            return Ok(asset(root,&id).ok_or("Model catalog entry is unavailable")?.model(root));
        }
    }
    // Resolve metadata again; the UI cannot supply a checksum, URL or local path.
    let entry=from_info(&info(&client()?,repo,Some(revision)).await?,kind).into_iter().find(|a|a.file==file).ok_or("This model file is not compatible or is unavailable")?;
    let id=entry.id();merge(root,vec![entry],false,None)?;
    Ok(asset(root,&id).ok_or("Model catalog entry is unavailable")?.model(root))
}
pub async fn refresh(root:&Path,force:bool)->Result<Status,String> {
    let Ok(_refresh)=REFRESH.try_lock() else {return Ok(status(root));};
    let previous=cache(root);let now=chrono::Utc::now().timestamp();
    let cooldown=if previous.error.is_some(){15*60}else{REFRESH_SECONDS};
    if !force && previous.attempted_at.is_some_and(|at|now>=at && now-at<cooldown) {return Ok(status_of(&previous));}
    let client=client()?;
    let speech=info(&client,WHISPER_REPO,None).await.map(|i|from_info(&i,Kind::Speech));
    let mut incoming=Vec::new();let mut failed=false;
    match speech {Ok(entries) if !entries.is_empty()=>incoming.extend(entries),_=>failed=true};
    incoming.extend(bundled_speech());
    let repos:HashSet<_>=seed().assets.into_iter().filter(|a|a.kind==Kind::Text).map(|a|a.repository).collect();
    let text:Vec<_>=stream::iter(repos.into_iter().map(|repo|{let client=&client;async move{info(client,&repo,None).await.map(|i|from_info(&i,Kind::Text).into_iter().filter(|a|a.quantization=="Q4_K_M").collect::<Vec<_>>())}})).buffer_unordered(4).collect().await;
    for result in text {match result {Ok(entries) if !entries.is_empty()=>incoming.extend(entries),_=>failed=true};}
    let popular=Search{kind:Kind::Text,query:String::new(),quantization:Some("Q4_K_M".into()),max_bytes:Some(8_000_000_000),language:None};
    match discover(&client,&popular).await {Ok(entries)=>incoming.extend(entries.into_iter().filter(|a|matching(a,&popular))),Err(_)=>failed=true};
    incoming.sort_by_key(|asset|(asset.kind==Kind::Text,asset.name.clone(),asset.size));
    merge(root,incoming,true,failed.then(||"Some cloud metadata could not be refreshed. The saved catalog remains available.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root()->PathBuf {let p=std::env::temp_dir().join(format!("no-tipe-hub-test-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&p).unwrap();p}
    #[test]
    fn popular_speech_models_are_available_offline_and_survive_old_catalogs() {
        let root=root();let mut old=seed();old.assets.retain(|a|a.files.is_empty()&&a.id()!="whisper-large-v3");
        old.attempted_at=Some(chrono::Utc::now().timestamp());write(&root,&old).unwrap();
        let entries=assets(&root,Kind::Speech);
        for id in [crate::sherpa::PARAKEET_ID,crate::sherpa::GIGAAM_V3_ID,crate::sherpa::GIGAAM_MULTILINGUAL_ID,crate::sherpa::GIGAAM_MULTILINGUAL_LARGE_ID,"whisper-large-v3-turbo","whisper-large-v3"] {assert!(entries.iter().any(|a|a.id()==id),"{id}");}
        if cfg!(target_os="macos") {assert!(entries.iter().any(|a|a.id()==crate::gigaam::ID));}
        let main=speech_results(&root,entries.clone(),"");
        assert!(main.iter().all(|a|speech_rank(a)<100||a.installed(&root)));
        assert!(entries.iter().any(|a|query_matches(a,"NVIDIA")));
        assert!(entries.iter().any(|a|query_matches(a,"OpenAI")));
        assert!(entries.iter().any(|a|query_matches(a,"Сбер")));
        for asset in entries {asset.validate().unwrap();}
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn windows_has_distinct_gigaam_bundles_and_search_aliases() {
        let entries=bundled_speech_for(false);
        assert!(!entries.iter().any(|a|a.architecture=="coreml"));
        let ids:HashSet<_>=entries.iter().map(Asset::id).collect();assert_eq!(ids.len(),entries.len());
        for id in [crate::sherpa::GIGAAM_V3_ID,crate::sherpa::GIGAAM_MULTILINGUAL_ID,crate::sherpa::GIGAAM_MULTILINGUAL_LARGE_ID] {
            let asset=entries.iter().find(|a|a.id()==id).unwrap();
            assert_eq!(asset.model(Path::new("unused")).provider,"sherpa-onnx");
            for query in ["giga","GigaChat","гигачат","гигаам","Сбер"] {assert!(query_matches(asset,query),"{id}: {query}");}
            assert!(!query_matches(asset,"NVIDIA"));
        }
    }
    #[test]
    fn one_repository_can_supply_multiple_pinned_speech_variants() {
        let assets:Vec<_>=bundled_speech().into_iter().filter(|a|a.architecture=="nemo_ctc").collect();
        let siblings:Vec<_>=assets.iter().flat_map(|a|a.files.iter()).map(|f|serde_json::json!({"rfilename":f.path,"size":f.size,"lfs":{"size":f.size,"sha256":f.sha256}})).collect();
        let mut info=serde_json::json!({"id":assets[0].repository,"sha":assets[0].revision,"siblings":siblings});
        assert_eq!(from_info(&info,Kind::Speech).len(),2);
        info["siblings"].as_array_mut().unwrap().retain(|f|f["rfilename"].as_str()!=Some("large/tokens.txt"));
        let parsed=from_info(&info,Kind::Speech);assert_eq!(parsed.len(),1);assert_eq!(parsed[0].id(),crate::sherpa::GIGAAM_MULTILINGUAL_ID);
        let large=&assets[1];assert!(large.file_url("large/tokens.txt").ends_with(&format!("/resolve/{}/large/tokens.txt",large.revision)));
        assert!(!large.file_url("large/tokens.txt").contains("/large/large/"));
    }
    #[test]
    fn speech_bundles_reject_changed_members_and_require_every_file() {
        let root=root();let asset=bundled_speech().remove(0);asset.validate().unwrap();
        for index in 0..asset.files.len() {
            let mut bad=asset.clone();bad.files[index].path="../escape".into();assert!(bad.validate().is_err());
            let mut bad=asset.clone();bad.files[index].sha256="0".repeat(64);assert!(bad.validate().is_err());
        }
        let mut bad=asset.clone();bad.revision="0".repeat(40);assert!(bad.validate().is_err());
        let directory=asset.path(&root);std::fs::create_dir_all(&directory).unwrap();
        for file in &asset.files {
            assert!(!asset.installed(&root));
            std::fs::File::create(directory.join(&file.path)).unwrap().set_len(file.size).unwrap();
        }
        assert!(asset.installed(&root));
        std::fs::remove_file(directory.join("tokens.txt")).unwrap();assert!(!asset.installed(&root));
        let status=crate::speech_bundle::status(&root,&asset).unwrap();assert_eq!(status.done,asset.size-asset.files.last().unwrap().size);assert!(status.resumable);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn remote_bundle_metadata_cannot_replace_the_tested_conversion() {
        let asset=bundled_speech().remove(0);
        let info=serde_json::json!({"id":asset.repository,"sha":asset.revision,"siblings":asset.files.iter().map(|f|serde_json::json!({"rfilename":f.path,"size":f.size,"lfs":{"size":f.size,"sha256":f.sha256}})).collect::<Vec<_>>()});
        assert_eq!(from_info(&info,Kind::Speech).len(),1);
        let mut incomplete=info.clone();incomplete["siblings"].as_array_mut().unwrap().pop();assert!(from_info(&incomplete,Kind::Speech).is_empty());
        let mut changed=info;changed["sha"]=Value::from("0".repeat(40));assert!(from_info(&changed,Kind::Speech).is_empty());
    }
    #[test]
    fn identifiers_and_urls_preserve_existing_choices_and_pin_weights() {
        for a in seed().assets {a.validate().unwrap();assert!(a.url().contains(&format!("/resolve/{}/",a.revision)));assert!(!a.url().contains("/main/"));}
        let a=seed().assets.into_iter().find(|a|a.name=="Qwen3.5 · 9B").unwrap();assert_eq!(a.id(),"qwen3.5-9b");
        let mut changed=a.clone();changed.revision="a".repeat(40);assert_eq!(a.id(),changed.id());
        for file in ["../bad.gguf","Qwen35-mmproj-Q4_K_M.gguf","Qwen35-Q4_K_M-00001-of-00002.gguf"] {changed.file=file.into();assert!(changed.validate().is_err());}
        changed=a;changed.repository="../model".into();assert!(changed.validate().is_err());
    }
    #[test]
    fn unsafe_or_corrupt_cache_falls_back_without_losing_offline_models() {
        let root=root();let mut bad=seed();bad.assets[0].file="../escape.bin".into();write(&root,&bad).unwrap();assert_eq!(cache(&root).assets[0].file,seed().assets[0].file);
        std::fs::write(cache_path(&root),"{").unwrap();assert_eq!(assets(&root,Kind::Text).len(),4);std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refresh_keeps_installed_revision_and_accepts_new_remote_models() {
        let root=root();let mut old=seed().assets.into_iter().find(|a|a.kind==Kind::Text).unwrap();old.size=24;
        let path=old.path(&root);std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut header=vec![0;24];header[..4].copy_from_slice(b"GGUF");header[4..8].copy_from_slice(&3u32.to_le_bytes());header[8..16].copy_from_slice(&1u64.to_le_bytes());std::fs::write(path,header).unwrap();
        let mut c=seed();c.assets.retain(|a|a.id()!=old.id());c.assets.push(old.clone());write(&root,&c).unwrap();
        let mut next=old.clone();next.revision="b".repeat(40);next.size=32;
        let mut new=next.clone();new.repository="example/Another-GGUF".into();new.file="Another-Q4_K_M.gguf".into();
        merge(&root,vec![next,new.clone()],true,None).unwrap();assert_eq!(asset(&root,&old.id()).unwrap().revision,old.revision);assert!(asset(&root,&new.id()).is_some());std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn incompatible_models_are_excluded_before_the_download() {
        let base=serde_json::json!({"id":"example/model-GGUF","sha":"a".repeat(40),"gated":false,"pipeline_tag":"text-generation","gguf":{"architecture":"qwen35","chat_template":"template"},"siblings":[{"rfilename":"model-Q4_K_M.gguf","size":100,"lfs":{"size":100,"sha256":"b".repeat(64)}}]});
        assert_eq!(from_info(&base,Kind::Text).len(),1);
        for (field,value) in [("/gguf/architecture",Value::from("unsupported")),("/gguf/chat_template",Value::Null),("/gated",Value::from("auto")),("/pipeline_tag",Value::from("feature-extraction"))] {let mut bad=base.clone();*bad.pointer_mut(field).unwrap()=value;assert!(from_info(&bad,Kind::Text).is_empty());}
        assert!(whisper_variant("ggml-small.en-q8_0.bin").is_some());assert!(whisper_variant("ggml-unknown.bin").is_none());
    }
    #[test]
    fn language_filters_use_declared_languages_instead_of_the_multilingual_label() {
        let mut model=seed().assets.into_iter().find(|a|a.kind==Kind::Text).unwrap();
        model.language_codes=vec!["en".into(),"es".into()];
        let mut filter=Search{kind:Kind::Text,query:String::new(),quantization:None,max_bytes:None,language:Some("ru".into())};
        assert!(!matching(&model,&filter));filter.language=Some("en".into());assert!(matching(&model,&filter));
        model.language_codes.clear();filter.language=Some("ru".into());assert!(matching(&model,&filter));
    }
    #[tokio::test]
    #[ignore="live Hugging Face metadata, no weight downloads"]
    async fn live_catalog_search_and_refresh() {
        let root=root();let result=search(&root,Search{kind:Kind::Text,query:"unsloth/Qwen3.5-4B-GGUF".into(),quantization:Some("Q4_K_M".into()),max_bytes:None,language:None}).await.unwrap();
        assert!(!result.cached);assert!(result.models.iter().any(|m|m.model.id=="qwen3.5-4b"));
        let status=refresh(&root,true).await.unwrap();assert!(status.updated_at.is_some(),"{:?}",status.error);assert!(assets(&root,Kind::Speech).len()>4);assert!(assets(&root,Kind::Text).len()>4);std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore="live Hugging Face GigaAM metadata, no weight downloads"]
    async fn live_gigaam_repository_urls_parse_every_supported_variant() {
        let root=root();
        for (query,expected) in [("https://huggingface.co/Alexxerm/gigaam-v3-e2e-rnnt-sherpa-onnx",vec![crate::sherpa::GIGAAM_V3_ID]),("https://huggingface.co/fussraider/GigaAM-Multilingual-sherpa-onnx-ctc",vec![crate::sherpa::GIGAAM_MULTILINGUAL_ID,crate::sherpa::GIGAAM_MULTILINGUAL_LARGE_ID])] {
            let result=search(&root,Search{kind:Kind::Speech,query:query.into(),quantization:None,max_bytes:None,language:None}).await.unwrap();
            assert!(!result.cached,"{:?}",result.warning);assert_eq!(result.models.len(),expected.len());
            for id in expected {assert!(result.models.iter().any(|m|m.model.id==id),"{query}: {id}");}
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
