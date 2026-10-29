from agents import (
    build_reader_agent, 
    build_search_agent, 
    writer_chain, 
    critic_chain
)



def run_research_pipline(topic: str) -> dict:

    state = {}

    # step 1 - search agent working
    print("\n"+"="*50)
    print("step 1 -search agent is working ...")
    print("="*50)

    search_agent = build_search_agent()
    search_result = search_agent.invoke({
        "messages":[("user",f"Find recent, reliable and detailed information about: {topic}")]
    })

    state["search_result"] = search_result["messages"][-1].content

    print("\n search result", state["search_result"])

    # step 2- reader agent
    print("\n"+"="*50)
    print("step 2 reader agent is scarapping ...")
    print("="*50)

    reader_agent = build_reader_agent()
    reader_result = reader_agent.invoke({
        "messages": [("user",
            f"Based on the following search results about '{topic}', "
            f"pick the most relevant URL and scrape it for deeper content.\n\n"
            f"Search Results:\n{state['search_result'][:800]}"
        )]
    })

    state["scraped_content"] = reader_result["messages"][-1].content

    print("\n srcaped content: \n", state["scraped_content"])

    print("\n" +"="*50)
    print("step 2 -writer is drafting the report ...")
    print("="*50)

    research_compliled = (
        f"SEARCHED RESULTS: {state['search_result']}\n\n"
        f"DETAILED SCRAPPED CONTENT: {state['scraped_content']}\n\n"
    )

    state["report"] = writer_chain.invoke({
        "topic" : topic,
        "research" :research_compliled
    })

    print("\n draft report: \n", state["report"])

    #critic report

    print("\n" +"="*50)
    print("step 3 -critic is reviewing the draft ...")
    print("="*50)

    state["feedback"]=critic_chain.invoke({
        "report" : state["report"]
    })

    print("\n feedback: \n", state["feedback"])

    return state




if __name__=="__main__":
    topic = input("\n Enter research topic : ")
    run_research_pipline(topic)




