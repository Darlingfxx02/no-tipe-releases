// Serialize writes while keeping controls responsive. A failed edit rolls back
// only its own patch; newer changes in other rows are never discarded.
export class PreferenceWriter<T extends object> {
  private pending:{patch:Partial<T>;resolve:()=>void;reject:(error:unknown)=>void}[]=[];
  private writing=false;
  private received=0;
  constructor(private confirmed:T,private persist:(value:T,patch:Partial<T>)=>Promise<void|T>,private changed:(value:T)=>void){}
  get value():T {return this.pending.reduce((value,item)=>({...value,...item.patch}),this.confirmed);}
  receive(value:T){this.received++;this.confirmed=value;this.changed(this.value);}
  save(patch:Partial<T>):Promise<void>{
    return new Promise((resolve,reject)=>{this.pending.push({patch,resolve,reject});this.changed(this.value);void this.drain();});
  }
  private async drain(){
    if(this.writing)return;this.writing=true;
    while(this.pending.length){
      const item=this.pending[0],next={...this.confirmed,...item.patch},received=this.received;
      try{const saved=await this.persist(next,item.patch);this.confirmed=this.received===received?(saved||next):{...this.confirmed,...item.patch};this.pending.shift();this.changed(this.value);item.resolve();}
      catch(error){this.pending.shift();this.changed(this.value);item.reject(error);}
    }
    this.writing=false;
  }
}
